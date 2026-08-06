const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { EXTERNAL_SHARES_COLLECTION } = require('./createShare')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
const SUPER_ADMINS_COLLECTION = 'superAdmins'

async function isSuperAdmin(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

async function appendShareSystemMessage(caseRef, text) {
  await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'system',
    type: 'manual_log',
    text,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Revokes an external share immediately - no grace period, no "takes effect
// at next access". getSharedCase re-checks share.status on every call, so a
// browser tab already open on a revoked share's link is refused on its very
// next request. Two authorized callers, deliberately narrower than
// createShare's one: the assigned Case Handler (never a Company Admin - see
// createShare.js's own re-check of this) may revoke a share on their own
// case, and a Super Admin may revoke any share platform-wide, mirroring the
// same "assigned handler, or Super Admin" shape revealIdentity.js and
// legalHold.js already use for other case-level authority.
exports.revokeExternalShare = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { shareId, reason } = request.data || {}
  const firestore = admin.firestore()

  if (typeof shareId !== 'string' || !shareId) {
    throw new HttpsError('invalid-argument', 'shareId is required')
  }

  const shareRef = firestore.collection(EXTERNAL_SHARES_COLLECTION).doc(shareId)
  const shareSnap = await shareRef.get()
  if (!shareSnap.exists) {
    throw new HttpsError('not-found', 'No such share')
  }
  const share = shareSnap.data()

  const caseRef = firestore.collection(CASES_COLLECTION).doc(share.caseId)
  const caseSnap = await caseRef.get()
  if (!caseSnap.exists) {
    throw new HttpsError('not-found', 'The underlying case record no longer exists')
  }
  const caseData = caseSnap.data()

  const superAdmin = await isSuperAdmin(firestore, uid)
  let actorRole = 'superAdmin'
  if (!superAdmin) {
    const role = await loadCallerRole(firestore, caseData.companyId, uid, 'external_share_revoke')
    actorRole = role
    const isAssignedCaseHandler = role === 'caseHandler' && caseData.assignedHandlerId === uid
    if (!isAssignedCaseHandler) {
      await logPrivilegedAction(firestore, {
        uid,
        companyId: caseData.companyId ?? null,
        role,
        action: 'external_share_revoke',
        outcome: 'denied:permission-denied',
        caseId: share.caseId,
        detail: 'not_assigned_case_handler',
      })
      throw new HttpsError(
        'permission-denied',
        'Only the assigned Case Handler or a Super Admin may revoke an external share'
      )
    }
  }

  if (share.status !== 'active') {
    throw new HttpsError('failed-precondition', `This share is already ${share.status}`)
  }

  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null

  await shareRef.update({
    status: 'revoked',
    revokedByUid: uid,
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    revokedReason: cleanReason,
  })

  await appendShareSystemMessage(
    caseRef,
    `The external share for ${share.recipientOrganisation ?? 'an external recipient'} was revoked.`
  )

  await logPrivilegedAction(firestore, {
    uid,
    companyId: caseData.companyId ?? null,
    role: actorRole,
    action: 'external_share_revoke',
    outcome: 'granted',
    caseId: share.caseId,
  })

  return { status: 'revoked' }
})
