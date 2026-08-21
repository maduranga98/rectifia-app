const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { PUBLISHED_BANDS, bandForEmployeeCount } = require('../billing/pricingEngine')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// A company with a subscriptionTier set but whose tier vocabulary doesn't
// match PUBLISHED_BANDS at all (a manually-negotiated plan) gets the same
// cap Starter would give it - a company must never be able to grow an
// unbounded roster on a plan whose tier we don't recognize.
const NO_TIER_CAP = 25

// A company with no subscriptionTier yet (a brand-new company that hasn't
// subscribed via createCheckoutSession.js) isn't capped at the self-serve
// Scale boundary - a real enterprise prospect building out their pilot
// roster must not be blocked mid-import just because they crossed 500
// employees, since that's exactly the segment requestQuote.js exists to
// convert, not exclude. It still can't grow completely unbounded without
// ever billing, so above the top published band it falls through to this
// flat sanity ceiling instead.
const SANITY_CEILING_EMPLOYEES = 10000

function capForTier(subscriptionTier, prospectiveEmployeeCount) {
  if (subscriptionTier) {
    const band = PUBLISHED_BANDS.find((b) => b.tier === subscriptionTier)
    return band ? band.maxEmployees : NO_TIER_CAP
  }
  const band = bandForEmployeeCount(prospectiveEmployeeCount)
  return band?.maxEmployees ?? SANITY_CEILING_EMPLOYEES
}

function normalizeEmail(email) {
  const trimmed = String(email ?? '').trim()
  return trimmed ? trimmed.toLowerCase() : null
}

// Company Admin only, callable. This - along with removeEmployee.js and
// bulkAddEmployees.js - is the only path left that can create or delete a
// companies/{companyId}/employees doc (see firestore.rules, which now only
// grants a Company Admin `update` on that collection, not `create`/
// `delete`). Moving the write here is what makes the headcount cap
// enforceable at all: the cap check and the roster write happen inside the
// same transaction as the currentEmployeeCount increment, so two concurrent
// adds can never both read "under cap" and both commit.
//
// currentEmployeeCount must already reflect the company's real roster
// before this is trustworthy - see backfillEmployeeCount.js, the one-time
// migration that seeds it for companies that predate this cap.
exports.addEmployee = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, name, department, email } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const trimmedName = String(name ?? '').trim()
  if (!trimmedName) {
    throw new HttpsError('invalid-argument', 'Name or employee ID is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage the roster for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'add_employee')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'add_employee',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may manage the employee roster')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const employeeRef = companyRef.collection(EMPLOYEES_SUBCOLLECTION).doc()

  await firestore.runTransaction(async (tx) => {
    const companySnapshot = await tx.get(companyRef)
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
    const cap = capForTier(company.subscriptionTier, currentCount + 1)

    if (currentCount >= cap) {
      if (!company.subscriptionTier && cap === SANITY_CEILING_EMPLOYEES) {
        throw new HttpsError(
          'failed-precondition',
          `Your roster has grown past ${SANITY_CEILING_EMPLOYEES} employees without a subscription — contact Rectifia to set up billing before adding more.`,
          { code: 'headcount_cap_reached', currentTier: null, cap }
        )
      }
      throw new HttpsError(
        'failed-precondition',
        `Adding this employee would exceed your plan's ${cap}-employee cap`,
        { code: 'headcount_cap_reached', currentTier: company.subscriptionTier ?? null, cap }
      )
    }

    tx.set(employeeRef, {
      name: trimmedName,
      department: String(department ?? '').trim() || null,
      email: normalizeEmail(email),
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    tx.update(companyRef, { currentEmployeeCount: currentCount + 1 })
  })

  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'add_employee', outcome: 'granted' })

  return { id: employeeRef.id }
})

exports.capForTier = capForTier
exports.NO_TIER_CAP = NO_TIER_CAP
exports.SANITY_CEILING_EMPLOYEES = SANITY_CEILING_EMPLOYEES
