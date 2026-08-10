const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { resolveStaffEffectivePermissions, hasPermission } = require('../utils/permissionResolver')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const DESIGNATED_HANDLERS_SUBCOLLECTION = 'designatedHandlers'

// The Whistleblower Protection Act's 従事者 (designated person) confidentiality
// obligation, in the exact wording a handler is shown before they acknowledge
// it and that gets stored verbatim on their designation record - so the record
// stays self-describing years later even if this text is later revised for a
// new designation. Pending review by employment counsel: this is an
// engineering default for the acknowledgment prompt, not legal advice, and not
// a substitute for the company's own JP counsel confirming the obligation is
// correctly stated for its circumstances.
const CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT =
  "I acknowledge that I have been designated a 従事者 (designated handler) under Japan's " +
  'Whistleblower Protection Act (Act No. 122 of 2004, as amended 2022). I understand that ' +
  'I am legally obligated to keep confidential any information that could identify a person ' +
  'who has made a whistleblowing report, that this obligation applies to information I obtain ' +
  'in the course of my duties as a designated handler, and that unauthorized disclosure of a ' +
  "reporter's identity may carry criminal penalty under the Act. I accept this obligation."

exports.CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT = CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT

// Verifies the caller is either this company's Company Admin or holds the
// composable 'designatedHandlers' permission - the same two-path check
// managePolicyDocument.js's loadOwnedPolicy uses for 'policyManagement'.
// Company Admin is checked first so a custom-role lookup never runs for the
// common case. Returns { uid, role } for the call site to log with.
async function requireDesignationManager(firestore, request, companyId, action) {
  const uid = requireAuthUid(request)
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const role = await loadCallerRole(firestore, companyId, uid, action)
  const resolved =
    role === 'companyAdmin' ? null : await resolveStaffEffectivePermissions(firestore, companyId, uid)
  const authorized = role === 'companyAdmin' || hasPermission(resolved, 'designatedHandlers')
  if (!authorized) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      detail: 'role_not_designation_manager',
    })
    throw new HttpsError(
      'permission-denied',
      'Only a Company Admin or a designatedHandlers-permitted role can manage the designated handler register'
    )
  }
  return { uid, role }
}

function designatedHandlerRef(firestore, companyId, staffUid) {
  return firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(DESIGNATED_HANDLERS_SUBCOLLECTION)
    .doc(staffUid)
}

// Formally designates a staff member as a 従事者 for this company. The
// designation is not complete on its own - acknowledgeConfidentiality below is
// a separate, self-served step - because the Act's obligation is personal to
// the handler and a third party accepting it on their behalf would defeat the
// point of recording it at all.
exports.designateHandler = onCall(async (request) => {
  const firestore = admin.firestore()
  const { companyId, staffUid } = request.data || {}
  const action = 'designated_handler_designate'
  const { uid: actorUid, role: actorRole } = await requireDesignationManager(
    firestore,
    request,
    companyId,
    action
  )

  if (!staffUid) {
    throw new HttpsError('invalid-argument', 'staffUid is required')
  }

  const staffSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(staffUid)
    .get()
  if (!staffSnapshot.exists || staffSnapshot.data().role !== 'caseHandler') {
    await logPrivilegedAction(firestore, {
      uid: actorUid,
      companyId,
      role: actorRole,
      action,
      outcome: 'denied:failed-precondition',
      detail: 'target_not_case_handler',
    })
    throw new HttpsError(
      'failed-precondition',
      'Only a staff member holding the Case Handler role can be designated'
    )
  }

  // A full overwrite, not a merge: a designation - including one that
  // replaces a prior revocation - always starts unacknowledged. Carrying a
  // stale confidentialityAcknowledgedAt forward across a revoke/re-designate
  // cycle would record the handler as having accepted an obligation for a
  // designation that did not exist yet when they acknowledged it.
  await designatedHandlerRef(firestore, companyId, staffUid).set({
    staffUid,
    designatedAt: admin.firestore.FieldValue.serverTimestamp(),
    designatedByUid: actorUid,
    status: 'active',
    revokedAt: null,
    revokedByUid: null,
    confidentialityAcknowledgedAt: null,
    confidentialityAcknowledgedText: null,
  })

  await logPrivilegedAction(firestore, {
    uid: actorUid,
    companyId,
    role: actorRole,
    action,
    outcome: 'granted',
    detail: staffUid,
  })

  return { success: true }
})

// Revokes a designation. Never deletes the doc - the register's evidentiary
// value depends on a full history of who was designated, by whom, and when
// that ended, surviving the revocation itself.
exports.revokeHandlerDesignation = onCall(async (request) => {
  const firestore = admin.firestore()
  const { companyId, staffUid, reason } = request.data || {}
  const action = 'designated_handler_revoke'
  const { uid: actorUid, role: actorRole } = await requireDesignationManager(
    firestore,
    request,
    companyId,
    action
  )

  if (!staffUid) {
    throw new HttpsError('invalid-argument', 'staffUid is required')
  }

  const ref = designatedHandlerRef(firestore, companyId, staffUid)
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such designation')
  }

  await ref.update({
    status: 'revoked',
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    revokedByUid: actorUid,
  })

  await logPrivilegedAction(firestore, {
    uid: actorUid,
    companyId,
    role: actorRole,
    action,
    outcome: 'granted',
    detail: reason ? `${staffUid}: ${reason}` : staffUid,
  })

  return { success: true }
})

// Self-served only: the caller acknowledges their OWN designation. staffUid
// is never taken from the request - it is always the authenticated caller's
// own uid - so there is no request shape that lets one staff member accept
// this obligation on behalf of another.
exports.acknowledgeConfidentiality = onCall(async (request) => {
  const firestore = admin.firestore()
  const { companyId } = request.data || {}
  const action = 'designated_handler_acknowledge'
  const uid = requireAuthUid(request)
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const role = await loadCallerRole(firestore, companyId, uid, action)

  const ref = designatedHandlerRef(firestore, companyId, uid)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.data().status !== 'active') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action,
      outcome: 'denied:failed-precondition',
      detail: 'no_active_designation',
    })
    throw new HttpsError('failed-precondition', 'You do not have an active designation to acknowledge')
  }

  await ref.update({
    confidentialityAcknowledgedAt: admin.firestore.FieldValue.serverTimestamp(),
    confidentialityAcknowledgedText: CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT,
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action,
    outcome: 'granted',
  })

  return { success: true }
})
