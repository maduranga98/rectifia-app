const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCaseForHandler, logPrivilegedAction } = require('../utils/staffAuth')
const { EXTERNAL_SHARE_COMMENTS_COLLECTION } = require('./submitExternalComment')

if (!admin.apps.length) {
  admin.initializeApp()
}

// The assigned handler's own view across all of this case's shares - not
// scoped to one shareId, since a handler reviewing feedback is reviewing the
// case, not any single link. Same authorization and the same explicit
// caseHandler-only re-check createShare.js/revokeShare.js/
// reviewExternalComment.js all already do.
exports.listExternalComments = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId } = request.data || {}
  const firestore = admin.firestore()

  const { snapshot, role } = await loadCaseForHandler(firestore, caseId, uid, 'external_comment_list')
  if (role !== 'caseHandler') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: snapshot.data().companyId ?? null,
      role,
      action: 'external_comment_list',
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'role_not_case_handler',
    })
    throw new HttpsError('permission-denied', "Only the assigned Case Handler may view this case's external feedback")
  }

  let commentsSnapshot
  try {
    commentsSnapshot = await firestore
      .collection(EXTERNAL_SHARE_COMMENTS_COLLECTION)
      .where('caseId', '==', caseId)
      .orderBy('submittedAt', 'desc')
      .get()
  } catch (err) {
    // A callable that throws a plain (non-HttpsError) error is collapsed by
    // the Functions framework into a bare 'internal' error with no detail
    // reaching the client - the exact failure mode listCaseShares.js already
    // hits if the composite index on (caseId, submittedAt) declared in
    // firestore.indexes.json was never actually deployed
    // (`firebase deploy --only firestore:indexes`) or is still building.
    // Logging the real error here is what makes that diagnosable from Cloud
    // Functions logs instead of a dead end.
    logger.error('listExternalComments: query failed', { caseId, error: err.message })
    throw err
  }

  const comments = commentsSnapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      commentId: doc.id,
      shareId: data.shareId ?? null,
      recipientName: data.recipientName ?? null,
      recipientOrganisation: data.recipientOrganisation ?? null,
      text: data.text ?? '',
      submittedAt: data.submittedAt?.toMillis?.() ?? null,
      status: data.status ?? 'pending',
      reviewedBy: data.reviewedBy ?? null,
      reviewedAt: data.reviewedAt?.toMillis?.() ?? null,
      loggedMessageId: data.loggedMessageId ?? null,
    }
  })

  return { comments }
})
