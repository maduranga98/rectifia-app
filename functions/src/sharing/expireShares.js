const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { EXTERNAL_SHARES_COLLECTION } = require('./createShare')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

// A run-bounded page, mirroring the same "no single scheduled invocation
// processes an unbounded backlog" discipline applyRetention.js and
// accessReview.js already follow. A platform with more elapsed shares in one
// day than this is not a realistic volume for this feature; the next day's
// run picks up whatever is left.
const MAX_SHARES_PER_RUN = 500

async function appendShareSystemMessage(caseRef, text) {
  await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'system',
    type: 'manual_log',
    text,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Resolves the creating handler's email once, at expiry time, rather than
// storing it on the share itself - a staff account's email can change, and
// the notification should reach wherever the handler can actually be
// reached today, not wherever they could be reached when the share was
// created.
async function resolveHandlerEmail(firestore, companyId, uid) {
  if (!companyId || !uid) return null
  const snapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(uid)
    .get()
  return snapshot.exists ? snapshot.data().email ?? null : null
}

// Runs daily. This is a bookkeeping sweep, not a security boundary:
// getSharedCase already refuses any share whose expiresAt has passed in
// real time, on every call, regardless of whether this job has run yet. What
// this adds is the status flip (so 'active' never lies about the true state
// once a day has passed) and the notification telling the handler their
// grant ended.
exports.expireShares = onSchedule('every day 02:00', async () => {
  const firestore = admin.firestore()
  const now = admin.firestore.Timestamp.now()

  const snapshot = await firestore
    .collection(EXTERNAL_SHARES_COLLECTION)
    .where('status', '==', 'active')
    .where('expiresAt', '<=', now)
    .limit(MAX_SHARES_PER_RUN)
    .get()

  let expired = 0
  for (const doc of snapshot.docs) {
    const share = doc.data()
    try {
      // eslint-disable-next-line no-await-in-loop
      await doc.ref.update({ status: 'expired' })

      const caseRef = firestore.collection(CASES_COLLECTION).doc(share.caseId)
      // eslint-disable-next-line no-await-in-loop
      await appendShareSystemMessage(
        caseRef,
        `The external share for ${share.recipientOrganisation ?? 'an external recipient'} expired.`
      )

      // eslint-disable-next-line no-await-in-loop
      const recipientEmail = await resolveHandlerEmail(firestore, share.companyId, share.createdByUid)
      if (recipientEmail) {
        // eslint-disable-next-line no-await-in-loop
        await firestore.collection(NOTIFICATIONS_COLLECTION).add({
          type: 'externalShareExpired',
          companyId: share.companyId ?? null,
          caseId: share.caseId,
          shareId: doc.id,
          recipientEmail,
          recipientOrganisation: share.recipientOrganisation ?? null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
        })
      }

      expired += 1
    } catch (err) {
      logger.error('expireShares: failed to expire share', { shareId: doc.id, error: err.message })
    }
  }

  logger.info('expireShares: run complete', { candidates: snapshot.size, expired })
})
