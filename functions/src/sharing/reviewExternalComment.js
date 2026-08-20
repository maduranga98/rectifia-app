const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCaseForHandler, logPrivilegedAction } = require('../utils/staffAuth')
const { EXTERNAL_SHARE_COMMENTS_COLLECTION } = require('./submitExternalComment')

if (!admin.apps.length) {
  admin.initializeApp()
}

const MESSAGES_SUBCOLLECTION = 'messages'
const VALID_ACTIONS = ['dismiss', 'log']

// Module 49 - the review queue's one write path into a case's own record.
//
// Every entry in a case's thread today traces back to an accountable,
// authenticated identity - a Case Handler's Firebase Auth uid. An external
// share recipient is deliberately not one of those: they hold a bearer
// token, proven by accessShare.js's verifyToken, which establishes only
// "whoever holds this was handed the link for this case," nothing about who
// is actually typing at any given moment. submitExternalComment.js writes
// their words to a holding collection only, and this is the sole place
// content from that collection can ever reach cases/{caseId}/messages - and
// only when an assigned, authenticated Case Handler explicitly acts, at
// which point the entry is attributed to THAT handler's uid, informed by but
// not authored by the external party.
exports.reviewExternalComment = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { commentId, action, text } = request.data || {}
  const firestore = admin.firestore()

  if (typeof commentId !== 'string' || !commentId) {
    throw new HttpsError('invalid-argument', 'commentId is required')
  }
  if (!VALID_ACTIONS.includes(action)) {
    throw new HttpsError('invalid-argument', `action must be one of ${VALID_ACTIONS.join(', ')}`)
  }

  const commentRef = firestore.collection(EXTERNAL_SHARE_COMMENTS_COLLECTION).doc(commentId)
  const commentSnap = await commentRef.get()
  if (!commentSnap.exists) {
    throw new HttpsError('not-found', 'No such feedback item')
  }
  const comment = commentSnap.data()

  const { caseRef, snapshot, role } = await loadCaseForHandler(
    firestore,
    comment.caseId,
    uid,
    'external_comment_review'
  )

  // Explicit, deliberate re-assertion rather than trusting HANDLER_ROLES
  // alone - the same defense-in-depth re-check createShare.js and
  // revokeShare.js both already do at the point of a sensitive write.
  if (role !== 'caseHandler') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: snapshot.data().companyId ?? null,
      role,
      action: 'external_comment_review',
      outcome: 'denied:permission-denied',
      caseId: comment.caseId,
      detail: 'role_not_case_handler',
    })
    throw new HttpsError('permission-denied', 'Only the assigned Case Handler may review this feedback')
  }

  // One-way, terminal transition: pending -> dismissed OR pending -> logged,
  // never back, and never a second review of an already-reviewed comment.
  // Enforced here, not just by a disabled button client-side.
  if (comment.status !== 'pending') {
    throw new HttpsError('failed-precondition', `This feedback has already been ${comment.status}`)
  }

  if (action === 'dismiss') {
    await commentRef.update({
      status: 'dismissed',
      reviewedBy: uid,
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await logPrivilegedAction(firestore, {
      uid,
      companyId: snapshot.data().companyId ?? null,
      role,
      action: 'external_comment_review',
      outcome: 'granted',
      caseId: comment.caseId,
      detail: 'dismissed',
    })

    return { status: 'dismissed' }
  }

  // action === 'log'. The caller may edit or paraphrase before logging - this
  // is not required to be a verbatim repost - but falls back to the
  // comment's original text verbatim if nothing was provided.
  const cleanText = typeof text === 'string' && text.trim() ? text.trim() : comment.text

  const messageRef = await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'investigator',
    type: 'manual_log',
    text: cleanText,
    investigatorId: uid,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })

  await commentRef.update({
    status: 'logged',
    reviewedBy: uid,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    loggedMessageId: messageRef.id,
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId: snapshot.data().companyId ?? null,
    role,
    action: 'external_comment_review',
    outcome: 'granted',
    caseId: comment.caseId,
    detail: 'logged',
  })

  return { status: 'logged', messageId: messageRef.id }
})
