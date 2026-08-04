const { HttpsError } = require('firebase-functions/v2/https')

const CASES_COLLECTION = 'cases'
const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'

// Roles allowed to act on a case's investigation. companyAdmin is included
// because a Company Admin can stand in for / oversee the assigned handler;
// see inviteStaff.js / roles.js for the full role vocabulary.
const HANDLER_ROLES = ['caseHandler', 'companyAdmin']

// Every staff-facing callable must establish *who is calling* from the
// Firebase Auth token, never from a client-supplied field. Returns the
// authenticated uid or throws 'unauthenticated'.
function requireAuthUid(request) {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to perform this action')
  }
  return uid
}

// Looks up the caller's staff record - the server-trusted record of who this
// account is and what role it holds - keyed by the Firebase Auth uid rather
// than any client-supplied id. Throws 'permission-denied' if the caller is
// not a staff member of this company. Returns the staff role string.
async function loadCallerRole(firestore, companyId, uid) {
  if (!companyId) {
    throw new HttpsError('permission-denied', 'This case is not associated with a company')
  }
  const snapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(uid)
    .get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'You are not a staff member of this company')
  }
  return snapshot.data().role
}

// Loads a case and verifies the *authenticated* caller (request.auth.uid,
// never a client-supplied investigatorId) is allowed to act on it: they must
// be a caseHandler or companyAdmin in the case's company AND be the handler
// this case is actually assigned to. This is the identity-verification gate
// that used to trust a caller-supplied investigatorId.
async function loadCaseForHandler(firestore, caseId, uid) {
  if (!caseId) {
    throw new HttpsError('invalid-argument', 'caseId is required')
  }

  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)
  const snapshot = await caseRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such case')
  }

  const caseData = snapshot.data()
  const role = await loadCallerRole(firestore, caseData.companyId, uid)
  if (!HANDLER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'You do not have permission to act on this case')
  }
  if (caseData.assignedHandlerId !== uid) {
    throw new HttpsError('permission-denied', 'This case is not assigned to you')
  }

  return { caseRef, snapshot }
}

module.exports = {
  HANDLER_ROLES,
  requireAuthUid,
  loadCallerRole,
  loadCaseForHandler,
}
