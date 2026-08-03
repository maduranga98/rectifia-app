const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const webpush = require('web-push')
const { verifyReporterAccess } = require('../intake/caseThread')
const { DECOY_TEMPLATES } = require('./decoyTemplates')

if (!admin.apps.length) {
  admin.initializeApp()
}

const PUSH_SUBSCRIPTIONS_COLLECTION = 'pushSubscriptions'

const vapidPublicKey = defineSecret('VAPID_PUBLIC_KEY')
const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY')
const vapidSubject = defineSecret('VAPID_SUBJECT')

// Registers (or replaces) the anonymous reporter's push subscription for one
// case. Keyed only by Case ID - never combined with the reporter's device
// info, email, or anything else identifying - and only reachable after the
// same Case ID + passcode check every other reporter action requires, so a
// caller can't register a subscription for a case that isn't theirs.
exports.registerPushSubscription = onCall(async (request) => {
  const { caseId, passcode, subscription } = request.data || {}
  if (!subscription?.endpoint || !subscription?.keys) {
    throw new HttpsError('invalid-argument', 'A valid push subscription is required')
  }

  const firestore = admin.firestore()
  await verifyReporterAccess(firestore, caseId, passcode)

  await firestore
    .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
    .doc(caseId)
    .set({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { success: true }
})

// Picks a decoy template different from whatever this case was last sent -
// tracked as lastTemplateId on the subscription doc itself, not on the case
// (the case doc never needs to know a notification was sent).
function pickTemplate(lastTemplateId) {
  const pool = DECOY_TEMPLATES.filter((t) => t.id !== lastTemplateId)
  return pool[Math.floor(Math.random() * pool.length)]
}

// Sends a push notification to the reporter for a case update (new
// investigator message, status change, etc). The push payload is built
// entirely from the randomly-chosen decoy template - subject, body, and
// preview text never reveal the case category or the words "case"/"report",
// and the same template is never repeated twice in a row for the same case.
// Staff invoke this (e.g. after posting an investigator message); it is not
// reachable by the reporter.
exports.sendCaseUpdate = onCall(
  { secrets: [vapidPublicKey, vapidPrivateKey, vapidSubject] },
  async (request) => {
    const { caseId } = request.data || {}
    if (!caseId) {
      throw new HttpsError('invalid-argument', 'caseId is required')
    }

    const firestore = admin.firestore()
    const subscriptionSnapshot = await firestore.collection(PUSH_SUBSCRIPTIONS_COLLECTION).doc(caseId).get()
    if (!subscriptionSnapshot.exists) {
      return { delivered: false, reason: 'no_subscription' }
    }

    const subscription = subscriptionSnapshot.data()
    const template = pickTemplate(subscription.lastTemplateId)

    webpush.setVapidDetails(vapidSubject.value(), vapidPublicKey.value(), vapidPrivateKey.value())

    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        JSON.stringify({ title: template.subject, body: template.body, preview: template.preview })
      )
    } catch (err) {
      logger.error('sendCaseUpdate: push send failed', { caseId, error: err.message })
      return { delivered: false, reason: 'send_failed' }
    }

    await subscriptionSnapshot.ref.update({
      lastTemplateId: template.id,
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    return { delivered: true }
  }
)
