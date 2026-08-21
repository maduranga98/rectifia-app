const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const NOTIFICATIONS_COLLECTION = 'notifications'
const DAY_MS = 24 * 60 * 60 * 1000
const WARNING_WINDOW_MS = 2 * DAY_MS

// Daily sweep over companies still on the 7-day trial clock
// (scheduleTrialExpiration.js). Only ever looks at companies with
// accessBlocked == false and a trialEndsAt within the lookahead window - a
// company already blocked, or whose trial isn't close to expiring yet, is
// never touched.
//
// A company that has EVER had a subscription linked - stripeSubscriptionId
// present at all, in any billingStatus - has permanently resolved the trial
// question: applySubscriptionState.js (shared by stripeWebhook.js and
// linkCompanySubscription.js) always clears accessBlocked the moment a
// subscription exists, so this sweep must never re-block or warn a company
// that field marks as already resolved, regardless of what
// billingStatus/trialEndsAt still say.
exports.checkTrialExpirations = onSchedule('every 24 hours', async () => {
  const firestore = admin.firestore()
  const now = Date.now()
  const lookaheadCutoff = admin.firestore.Timestamp.fromMillis(now + WARNING_WINDOW_MS)

  const snapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .where('accessBlocked', '==', false)
    .where('trialEndsAt', '<=', lookaheadCutoff)
    .get()

  let blocked = 0
  let warned = 0

  for (const doc of snapshot.docs) {
    const company = doc.data()
    if (Object.prototype.hasOwnProperty.call(company, 'stripeSubscriptionId')) {
      continue
    }

    const trialEndsAtMs =
      typeof company.trialEndsAt?.toMillis === 'function' ? company.trialEndsAt.toMillis() : null
    if (trialEndsAtMs === null) continue

    if (trialEndsAtMs <= now) {
      await doc.ref.update({
        accessBlocked: true,
        accessBlockedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      await firestore
        .collection(NOTIFICATIONS_COLLECTION)
        .doc(`trialExpired_${doc.id}`)
        .set(
          {
            type: 'trialExpired',
            companyId: doc.id,
            trialEndsAt: company.trialEndsAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
          },
          { merge: true }
        )
      blocked += 1
    } else if (!company.trialWarningNotifiedAt) {
      await doc.ref.update({
        trialWarningNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      await firestore
        .collection(NOTIFICATIONS_COLLECTION)
        .doc(`trialWarning_${doc.id}`)
        .set(
          {
            type: 'trialEndingSoon',
            companyId: doc.id,
            trialEndsAt: company.trialEndsAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
          },
          { merge: true }
        )
      warned += 1
    }
  }

  logger.info('checkTrialExpirations: run complete', { candidates: snapshot.size, blocked, warned })
})
