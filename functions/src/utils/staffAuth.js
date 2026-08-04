const { HttpsError } = require('firebase-functions/v2/https')

const CASES_COLLECTION = 'cases'
const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'

// Roles allowed to act on a case's investigation. companyAdmin is included
// because a Company Admin can stand in for / oversee the assigned handler;
// see inviteStaff.js / roles.js for the full role vocabulary.
const HANDLER_ROLES = ['caseHandler', 'companyAdmin']

// Roles that may read a *still unassigned* case in order to place it. These
// are the two oversight roles that already hold the reassign power (see
// REASSIGN_ROLES in functions/src/intake/routeCase.js) - triage is reading
// enough of the case to exercise that power responsibly, not a new one.
const TRIAGE_ROLES = ['hrCoordinator', 'companyAdmin']

// Roles that may file a case on behalf of a reporter
// (functions/src/intake/createCaseOnBehalf.js). These are the two roles that
// actually take reports by phone, by email, or across a desk.
//
// companyAdmin is deliberately absent, and this is the one place in this file
// where that role is narrower than TRIAGE_ROLES rather than wider. A Company
// Admin's zero-case-content design is a conflict-of-interest control (see the
// caseMetadata block in firestore.rules): an intake form is case content -
// the fullest form of it, since whoever types it reads every answer - so
// granting it here would hand that role the case narrative the rest of the
// system spends its rules budget keeping away from them.
const INTAKE_ROLES = ['caseHandler', 'hrCoordinator']

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

// The triage counterpart of loadCaseForHandler above. Same identity rule -
// the caller is whoever request.auth.uid says they are, never a client-
// supplied id - but a different question: not "is this case assigned to
// you?" (by definition it is assigned to nobody yet) but "are you one of
// this company's two oversight roles?".
//
// This deliberately verifies membership only. Whether the case is *still*
// triageable (status) and whether this company may see it at all (conflict
// of interest) are decided by the caller, getCaseForTriage.js, because those
// rejections have to be written to the triage access log along with the
// company and role established here.
async function loadCaseForTriage(firestore, caseId, uid) {
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
  if (!TRIAGE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'You do not have permission to triage cases')
  }

  return { caseRef, snapshot, role }
}

// The intake counterpart of loadCaseForHandler/loadCaseForTriage, for the one
// staff action that happens *before* a case exists and so has no case document
// to authorize against: filing on behalf of a reporter.
//
// The company is taken from the caller's own custom claim, never from the
// request body - a client-supplied companyId would let any staff member file
// into another company's queue, the exact spoof submitCase.js avoids by
// re-resolving the reporter's slug server-side. The claim is then checked
// against the staff subcollection by loadCallerRole, so a stale claim on a
// deactivated account still fails.
async function requireIntakeRole(firestore, request, uid) {
  const companyId = request.auth?.token?.companyId
  if (!companyId) {
    throw new HttpsError(
      'permission-denied',
      'Your account is not linked to a company, so it cannot file a case'
    )
  }
  const role = await loadCallerRole(firestore, companyId, uid)
  if (!INTAKE_ROLES.includes(role)) {
    throw new HttpsError(
      'permission-denied',
      'Only a Case Handler or HR Coordinator may file a case on behalf of a reporter'
    )
  }
  return { companyId, role }
}

module.exports = {
  HANDLER_ROLES,
  TRIAGE_ROLES,
  INTAKE_ROLES,
  requireAuthUid,
  loadCallerRole,
  loadCaseForHandler,
  loadCaseForTriage,
  requireIntakeRole,
}
