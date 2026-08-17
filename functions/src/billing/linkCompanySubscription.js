const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { applySubscriptionState } = require('./applySubscriptionState')
const { LINE_ITEM_TAG } = require('./lineItemTags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const SUPER_ADMINS_COLLECTION = 'superAdmins'
const BILLING_HISTORY_SUBCOLLECTION = 'billingHistory'

// The plans a Super Admin can label a linked subscription with - kept in
// sync by hand with src/services/companyService.js's SUBSCRIPTION_TIERS,
// same as every other client/functions vocabulary pair in this codebase
// (there is no shared module between the two bundles).
const SUBSCRIPTION_TIERS = ['starter', 'professional', 'enterprise']

const VALID_LINE_ITEM_TAGS = new Set(Object.values(LINE_ITEM_TAG))

// Super Admin is allowlist membership at superAdmins/{uid}, not a custom
// claim - the same check firestore.rules and createCompanyAdmin.js's
// requireSuperAdmin use.
async function requireSuperAdmin(actorUid) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Super Admin to link a subscription')
  }
  const snapshot = await admin.firestore().collection(SUPER_ADMINS_COLLECTION).doc(actorUid).get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can link a company subscription')
  }
}

// Every line item's product must carry the `rectifiaLineItem` metadata tag
// (see lineItemTags.js) before this subscription can be linked - it's what
// applySubscriptionState() uses to tell the Core item from the Pulse Check
// item, and an item with no tag (or an unrecognised one) would silently fall
// through both lookups, linking a subscription the app can never correctly
// interpret. Caught here, at link time, with an error that names the
// specific item and tells the Super Admin exactly what to fix - rather than
// linking anyway and leaving featureFlags.pulseCheck (or the plan itself)
// permanently wrong.
function assertLineItemsTagged(subscription) {
  const items = subscription.items?.data ?? []
  for (const item of items) {
    const tag = item.price?.product?.metadata?.rectifiaLineItem
    if (!VALID_LINE_ITEM_TAGS.has(tag)) {
      const productName = item.price?.product?.name || item.price?.product?.id || item.id
      throw new HttpsError(
        'failed-precondition',
        `Stripe line item "${productName}" has no valid rectifiaLineItem metadata tag. ` +
          `Add rectifiaLineItem: "${LINE_ITEM_TAG.CORE}" or "${LINE_ITEM_TAG.PULSE_CHECK}" to this item's ` +
          'product in the Stripe Dashboard before linking this subscription.'
      )
    }
  }
}

// Super Admin only, callable. Links (or re-links, to change the plan or
// re-sync after a Dashboard edit) a Stripe subscription a human already
// created - via an accepted Quote (requestQuote.js) or set up directly in
// the Stripe Dashboard - to a company. This never creates a Stripe
// subscription itself; pilot v1's founding-customer negotiated-pricing
// model keeps subscription creation a human, out-of-band act, and this
// callable's only job is to make the company doc agree with whatever
// subscription already exists.
//
// Calling this again against the same (or an updated) subscription is also
// the "change plan" path - Pulse Check added/removed in Stripe, or the
// negotiated tier renamed - since applySubscriptionState() always
// reconciles from the live subscription and subscriptionTier is always
// rewritten to whatever is passed. There is no separate upgrade/downgrade
// function.
exports.linkCompanySubscription = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = request.auth?.uid
  await requireSuperAdmin(uid)

  const { companyId, stripeSubscriptionId, subscriptionTier } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  if (typeof stripeSubscriptionId !== 'string' || !stripeSubscriptionId.trim()) {
    throw new HttpsError('invalid-argument', 'stripeSubscriptionId is required')
  }
  if (!SUBSCRIPTION_TIERS.includes(subscriptionTier)) {
    throw new HttpsError('invalid-argument', 'A valid subscriptionTier is required')
  }

  const firestore = admin.firestore()

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const previousState = companySnapshot.data()

  // Refuse if this Stripe subscription is already linked to a DIFFERENT
  // company - one subscription must never end up attached to two companies
  // by accident. Re-linking the same subscription to the same company (a
  // plan-change re-sync) is fine and falls straight through this check.
  const conflictingCompanies = await firestore
    .collection(COMPANIES_COLLECTION)
    .where('stripeSubscriptionId', '==', stripeSubscriptionId.trim())
    .get()
  const conflict = conflictingCompanies.docs.find((doc) => doc.id !== companyId)
  if (conflict) {
    throw new HttpsError(
      'failed-precondition',
      `Stripe subscription ${stripeSubscriptionId.trim()} is already linked to another company (${
        conflict.data().name || conflict.id
      }). Unlink it there first.`
    )
  }

  // The subscription's status/tier/items are never trusted from the client -
  // only the id is. Retrieved live, expanded the same way stripeWebhook.js
  // expands it, so applySubscriptionState() sees exactly what it would see
  // from a webhook event.
  const stripe = getStripeClient()
  let subscription
  try {
    subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId.trim(), {
      expand: ['items.data.price.product'],
    })
  } catch (err) {
    throw new HttpsError('not-found', `Could not retrieve Stripe subscription: ${err.message}`)
  }

  assertLineItemsTagged(subscription)

  await applySubscriptionState(firestore, companyId, subscription)
  await companyRef.update({ subscriptionTier })

  await companyRef.collection(BILLING_HISTORY_SUBCOLLECTION).add({
    action: 'billing_linked',
    linkedByUid: uid,
    stripeSubscriptionId: subscription.id,
    previousState: {
      billingStatus: previousState.billingStatus ?? null,
      subscriptionTier: previousState.subscriptionTier ?? null,
      stripeSubscriptionId: previousState.stripeSubscriptionId ?? null,
    },
    newState: {
      billingStatus: subscription.status,
      subscriptionTier,
      stripeSubscriptionId: subscription.id,
    },
    at: admin.firestore.FieldValue.serverTimestamp(),
  })

  return {
    billingStatus: subscription.status,
    subscriptionTier,
    stripeSubscriptionId: subscription.id,
  }
})
