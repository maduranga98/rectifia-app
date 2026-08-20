const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')
const { EXTERNAL_SHARES_COLLECTION } = require('./createShare')
const { verifyToken, logExternalAccess } = require('./accessShare')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
const EXTERNAL_SHARE_COMMENTS_COLLECTION = 'externalShareComments'

const MAX_TEXT_LENGTH = 4000

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : value ?? null
}

// Appends the same content-free 'system' nudge every administrative case
// event writes (see createShare.js's appendShareSystemMessage) - the handler
// sees that feedback arrived and where to review it, never the text itself.
// The actual note text reaches the case thread through exactly one path:
// reviewExternalComment.js, after a human decides to log it.
async function appendCommentSystemMessage(caseRef, recipientOrganisation) {
  await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'system',
    type: 'manual_log',
    text: `${recipientOrganisation ?? 'The external recipient'} left a note via the shared case link - see the External share tab to review.`,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Module 49. Lets the holder of a share link send feedback back, without
// ever writing directly into the case record - see the module comment on
// reviewExternalComment.js for the full accountability argument. This
// callable's job is narrower than that: verify the same bearer token
// getSharedCase.js verifies, using the exact same verifyToken/
// logExternalAccess this module reuses rather than reimplements, and then
// drop the submitted text into a holding collection nobody can read except
// through the three callables in this module.
exports.submitExternalComment = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { shareId, token, text } = request.data || {}
  const firestore = admin.firestore()

  if (typeof shareId !== 'string' || !shareId || typeof token !== 'string' || !token) {
    throw new HttpsError('invalid-argument', 'shareId and token are required')
  }
  const cleanText = typeof text === 'string' ? text.trim() : ''
  if (!cleanText) {
    throw new HttpsError('invalid-argument', 'Feedback text is required')
  }
  if (cleanText.length > MAX_TEXT_LENGTH) {
    throw new HttpsError('invalid-argument', `Feedback must be ${MAX_TEXT_LENGTH} characters or fewer`)
  }

  await enforceRateLimit(firestore, 'submitExternalComment', request, { scope: `share:${shareId}` })

  const shareRef = firestore.collection(EXTERNAL_SHARES_COLLECTION).doc(shareId)
  const shareSnap = await shareRef.get()

  if (!shareSnap.exists) {
    await logExternalAccess(firestore, { shareId, caseId: null, request, outcome: 'denied:not_found' })
    throw new HttpsError('permission-denied', 'This link is invalid or has expired')
  }
  const share = shareSnap.data()

  if (!verifyToken(token, share.tokenHash, share.tokenSalt)) {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:bad_token' })
    // Identical message to "not found" - same no-oracle discipline
    // getSharedCase.js and accessSharedEvidence.js both already follow.
    throw new HttpsError('permission-denied', 'This link is invalid or has expired')
  }

  if (share.status === 'revoked') {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:revoked' })
    throw new HttpsError('permission-denied', 'This share has been revoked')
  }

  const expiresAtMs = toMillis(share.expiresAt)
  if (share.status === 'expired' || (expiresAtMs !== null && Date.now() >= expiresAtMs)) {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:expired' })
    throw new HttpsError('permission-denied', 'This share has expired')
  }

  // A comment cannot arrive before the undertaking gate was passed - the same
  // acceptedAt getSharedCase.js sets on first successful access.
  if (!share.acceptedAt) {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:not_accepted' })
    throw new HttpsError('failed-precondition', 'You must open the shared case record before sending feedback')
  }

  const caseRef = firestore.collection(CASES_COLLECTION).doc(share.caseId)
  const caseSnap = await caseRef.get()
  if (!caseSnap.exists) {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:case_missing' })
    throw new HttpsError('not-found', 'The underlying case record no longer exists')
  }

  const commentRef = firestore.collection(EXTERNAL_SHARE_COMMENTS_COLLECTION).doc()
  await commentRef.set({
    shareId,
    caseId: share.caseId,
    // Copied at submission time, for display without a join - the same
    // reasoning createShare.js's own frozen sharedEvidence allowlist follows.
    recipientName: share.recipientName ?? null,
    recipientOrganisation: share.recipientOrganisation ?? null,
    text: cleanText,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    loggedMessageId: null,
  })

  await appendCommentSystemMessage(caseRef, share.recipientOrganisation)

  await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'comment_submitted' })

  return { commentId: commentRef.id }
})

exports.EXTERNAL_SHARE_COMMENTS_COLLECTION = EXTERNAL_SHARE_COMMENTS_COLLECTION
