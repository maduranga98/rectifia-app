const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// Company Admin only, callable - the delete counterpart of addEmployee.js.
// firestore.rules no longer grants a Company Admin `delete` on
// companies/{companyId}/employees, so this is the only way a roster entry
// goes away. Decrements currentEmployeeCount in the same transaction as the
// delete (floored at 0 rather than a raw FieldValue.increment(-1), so a
// count that's already out of sync can't be pushed negative by a further
// removal).
exports.removeEmployee = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, employeeId } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  if (typeof employeeId !== 'string' || !employeeId) {
    throw new HttpsError('invalid-argument', 'employeeId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage the roster for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'remove_employee')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'remove_employee',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may manage the employee roster')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const employeeRef = companyRef.collection(EMPLOYEES_SUBCOLLECTION).doc(employeeId)

  await firestore.runTransaction(async (tx) => {
    const [companySnapshot, employeeSnapshot] = await Promise.all([tx.get(companyRef), tx.get(employeeRef)])
    if (!companySnapshot.exists) {
      throw new HttpsError('not-found', 'Company not found')
    }
    if (!employeeSnapshot.exists) {
      throw new HttpsError('not-found', 'Employee not found')
    }
    const currentCount = Number(companySnapshot.data().currentEmployeeCount) || 0
    tx.delete(employeeRef)
    tx.update(companyRef, { currentEmployeeCount: Math.max(0, currentCount - 1) })
  })

  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'remove_employee', outcome: 'granted' })

  return { removed: true }
})
