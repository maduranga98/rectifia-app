const { HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const CASES_COLLECTION = 'cases'
const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'

// Module 26. Every staff-facing callable ultimately resolves "who is calling,
// with what role, and are they allowed to do this" through this file - it is
// the one chokepoint every privileged action passes through, whether directly
// (loadCallerRole) or via one of the three wrappers below. That makes it the
// right place to close the gap the four pre-existing audit logs
// (identityAccessAuditLog, triageAccessLog, staffIntakeAuditLog,
// evidenceAccessLog) never covered: everything that is NOT a decrypt, a
// triage read, a staff-filed intake, or an evidence access - proposeAction,
// closeCase, reassignCase, legal holds, policy management, benchmark opt-in,
// pulse-check administration, and more - previously left no actor-level trace
// at all.
//
// Metadata only, same discipline as the other four logs: who (uid), which
// company, what role, what action *type* (a short label the call site
// chooses, e.g. 'case_handler_action', 'legal_hold_set'), granted or denied,
// and a caseId if one is in scope. Never a questionnaire answer, a narrative,
// an identity, or evidence content - this collection describes the act of
// calling a privileged function, not what the function touched.
const PRIVILEGED_ACTION_LOG_COLLECTION = 'privilegedActionLog'

async function logPrivilegedAction(firestore, { uid, companyId, role, action, outcome, caseId, detail }) {
  try {
    await firestore.collection(PRIVILEGED_ACTION_LOG_COLLECTION).add({
      uid: uid ?? null,
      companyId: companyId ?? null,
      role: role ?? null,
      action: action ?? 'unknown',
      outcome,
      caseId: caseId ?? null,
      detail: detail ?? null,
      at: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch {
    // A failure to write the audit trail must never fail - or silently swallow
    // the outcome of - the privileged action itself. Every call site awaits
    // this with its own .catch(() => {}) already; this is a second backstop
    // for a call site that forgets to.
  }
}

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
//
// `action` is an optional label the call site passes so a structural denial
// here (no company, not staff) lands in privilegedActionLog under the same
// action type its caller would have used for a granted call - a denial is
// worth exactly as much of an accountability trail as a grant. The final
// "was this role actually allowed to do this" decision is a business rule
// each call site knows and this function does not, so a *grant* is never
// logged here - only by whoever makes that final call (the three wrappers
// below, or the callable itself when it calls loadCallerRole directly).
async function loadCallerRole(firestore, companyId, uid, action = 'staff_role_check') {
  if (!companyId) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: null,
      role: null,
      action,
      outcome: 'denied:permission-denied',
      detail: 'no_company',
    })
    throw new HttpsError('permission-denied', 'This case is not associated with a company')
  }
  const snapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(uid)
    .get()
  if (!snapshot.exists) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role: null,
      action,
      outcome: 'denied:permission-denied',
      detail: 'not_staff',
    })
    throw new HttpsError('permission-denied', 'You are not a staff member of this company')
  }
  return snapshot.data().role
}

// Loads a case and verifies the *authenticated* caller (request.auth.uid,
// never a client-supplied investigatorId) is allowed to act on it: they must
// be a caseHandler or companyAdmin in the case's company AND be the handler
// this case is actually assigned to. This is the identity-verification gate
// that used to trust a caller-supplied investigatorId.
async function loadCaseForHandler(firestore, caseId, uid, action = 'case_handler_action') {
  if (!caseId) {
    throw new HttpsError('invalid-argument', 'caseId is required')
  }

  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)
  const snapshot = await caseRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such case')
  }

  const caseData = snapshot.data()
  const role = await loadCallerRole(firestore, caseData.companyId, uid, action)
  if (!HANDLER_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: caseData.companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'role_not_handler',
    })
    throw new HttpsError('permission-denied', 'You do not have permission to act on this case')
  }
  if (caseData.assignedHandlerId !== uid) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: caseData.companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'not_assigned_handler',
    })
    throw new HttpsError('permission-denied', 'This case is not assigned to you')
  }

  await logPrivilegedAction(firestore, {
    uid,
    companyId: caseData.companyId,
    role,
    action,
    outcome: 'granted',
    caseId,
  })
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
async function loadCaseForTriage(firestore, caseId, uid, action = 'case_triage_read') {
  if (!caseId) {
    throw new HttpsError('invalid-argument', 'caseId is required')
  }

  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)
  const snapshot = await caseRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such case')
  }

  const caseData = snapshot.data()
  const role = await loadCallerRole(firestore, caseData.companyId, uid, action)
  if (!TRIAGE_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: caseData.companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'role_not_triage',
    })
    throw new HttpsError('permission-denied', 'You do not have permission to triage cases')
  }

  // getCaseForTriage.js writes its own, richer entry to triageAccessLog for
  // this same read (it additionally knows the case's status and routing
  // reason, which this function does not check). This entry is deliberately
  // still written - it is the generic "a privileged action was granted" trail
  // every action type gets, not a replacement for that more specific log.
  await logPrivilegedAction(firestore, {
    uid,
    companyId: caseData.companyId,
    role,
    action,
    outcome: 'granted',
    caseId,
  })
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
async function requireIntakeRole(firestore, request, uid, action = 'staff_intake') {
  const companyId = request.auth?.token?.companyId
  if (!companyId) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: null,
      role: null,
      action,
      outcome: 'denied:permission-denied',
      detail: 'no_company_claim',
    })
    throw new HttpsError(
      'permission-denied',
      'Your account is not linked to a company, so it cannot file a case'
    )
  }
  const role = await loadCallerRole(firestore, companyId, uid, action)
  if (!INTAKE_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      detail: 'role_not_intake',
    })
    throw new HttpsError(
      'permission-denied',
      'Only a Case Handler or HR Coordinator may file a case on behalf of a reporter'
    )
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action, outcome: 'granted' })
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
  logPrivilegedAction,
  PRIVILEGED_ACTION_LOG_COLLECTION,
}
