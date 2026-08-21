const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { capForTier } = require('./addEmployee')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// Firestore caps a batch at 500 writes; stay under it with room to spare, the
// same margin src/services/employeeService.js's old client-side import used.
const BATCH_SIZE = 400

function normalizeEmail(email) {
  const trimmed = String(email ?? '').trim()
  return trimmed ? trimmed.toLowerCase() : null
}

// The CSV-import counterpart of addEmployee.js - same cap enforcement, same
// "no client write path" reasoning, but for many rows in one call instead of
// one. Existing employees are matched by email (a re-import of an updated
// export refreshes names/departments in place rather than duplicating
// everyone), mirroring the client-side importEmployees() this replaces; rows
// with no email are always treated as new adds, since there is nothing
// stable to match them on.
//
// Only genuinely NEW rows count against the headcount cap - updating an
// existing employee's department or email doesn't grow the roster. The cap
// is checked once, against the whole batch, before any writes: a CSV that
// would blow through the cap is rejected outright rather than partially
// imported up to the limit, so a Company Admin isn't left guessing which
// rows made it in.
exports.bulkAddEmployees = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, employees: rows } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new HttpsError('invalid-argument', 'employees must be a non-empty array')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage the roster for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'bulk_add_employees')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'bulk_add_employees',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may manage the employee roster')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()
  if (company.accessBlocked === true) {
    throw new HttpsError(
      'failed-precondition',
      'Your trial has ended. A Company Admin needs to subscribe on the Billing page to resume adding employees.'
    )
  }
  const currentCount = Number(company.currentEmployeeCount) || 0
  const cap = capForTier(company.subscriptionTier)

  const employeesCollection = companyRef.collection(EMPLOYEES_SUBCOLLECTION)
  const existingSnapshot = await employeesCollection.get()
  const byEmail = new Map()
  existingSnapshot.docs.forEach((d) => {
    const email = d.data().email
    if (email) byEmail.set(email, d.id)
  })

  const validRows = rows
    .map((row) => ({
      name: String(row?.name ?? '').trim(),
      department: String(row?.department ?? '').trim() || null,
      email: normalizeEmail(row?.email),
    }))
    .filter((row) => row.name)

  const newRowCount = validRows.filter((row) => !(row.email && byEmail.has(row.email))).length

  if (currentCount + newRowCount > cap) {
    throw new HttpsError(
      'failed-precondition',
      `Importing ${newRowCount} new employee${newRowCount === 1 ? '' : 's'} would exceed your plan's ${cap}-employee cap`,
      { code: 'headcount_cap_reached', currentTier: company.subscriptionTier ?? null, cap }
    )
  }

  let batch = firestore.batch()
  let pendingWrites = 0
  let added = 0
  let updated = 0

  for (const row of validRows) {
    const payload = {
      name: row.name,
      department: row.department,
      email: row.email,
      status: 'active',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    const existingId = row.email ? byEmail.get(row.email) : undefined

    if (existingId) {
      batch.update(employeesCollection.doc(existingId), payload)
      updated += 1
    } else {
      const ref = employeesCollection.doc()
      batch.set(ref, { ...payload, createdAt: admin.firestore.FieldValue.serverTimestamp() })
      if (row.email) byEmail.set(row.email, ref.id)
      added += 1
    }

    pendingWrites += 1
    if (pendingWrites >= BATCH_SIZE) {
      await batch.commit()
      batch = firestore.batch()
      pendingWrites = 0
    }
  }
  if (pendingWrites > 0) {
    await batch.commit()
  }

  if (added > 0) {
    await companyRef.update({ currentEmployeeCount: admin.firestore.FieldValue.increment(added) })
  }

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'bulk_add_employees',
    outcome: 'granted',
    detail: `added:${added},updated:${updated}`,
  })

  return { added, updated }
})
