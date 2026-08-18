const { onRequest } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { stripeSecretKey, stripeWebhookSecret, getStripeClient } = require('./stripeClient')
const { applySubscriptionState } = require('./applySubscriptionState')
const { LINE_ITEM_TAG, RECTIFIA_TIER_METADATA_KEY } = require('./lineItemTags')
const { applyTierFeatureFlags } = require('../utils/featureFlags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Self-serve subscriptions (createCheckoutSession.js, upgradeSubscriptionTier.js)
// tag the Core item's product with rectifiaTier alongside rectifiaLineItem -
// see lineItemTags.js. applySubscriptionState() doesn't write
// company.subscriptionTier itself (that field is also set by hand, via
// linkCompanySubscription.js, for a manually-negotiated subscription whose
// Core product carries no rectifiaTier tag at all), so this is the one other
// place that keeps it in sync: whenever the tag is present, write it;
// whenever it's absent (a Quote-derived or Dashboard-created subscription),
// do nothing and leave subscriptionTier exactly as a human last set it.
async function syncSelfServeTier(firestore, companyId, subscription) {
  const items = subscription.items?.data ?? []
  const coreItem = items.find((item) => item.price?.product?.metadata?.rectifiaLineItem === LINE_ITEM_TAG.CORE)
  const tier = coreItem?.price?.product?.metadata?.[RECTIFIA_TIER_METADATA_KEY]
  if (tier) {
    await firestore.collection(COMPANIES_COLLECTION).doc(companyId).update({ subscriptionTier: tier })
    await applyTierFeatureFlags(firestore, companyId, tier)
  }
}

async function handleCheckoutCompleted(stripe, firestore, session) {
  if (session.mode !== 'subscription' || !session.subscription) return
  const companyId = session.metadata?.companyId
  if (!companyId) {
    logger.warn('stripeWebhook: checkout.session.completed with no companyId metadata', { sessionId: session.id })
    return
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  })
  await applySubscriptionState(firestore, companyId, subscription)
  await syncSelfServeTier(firestore, companyId, subscription)
}

async function handleSubscriptionUpdated(stripe, firestore, subscriptionEventObject) {
  const companyId = subscriptionEventObject.metadata?.companyId
  if (!companyId) {
    // Not every subscription on the Stripe account is necessarily ours (a
    // shared Stripe account, a subscription created by hand in the
    // Dashboard for testing) - silently skip rather than treat a missing
    // companyId as an error.
    return
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionEventObject.id, {
    expand: ['items.data.price.product'],
  })
  await applySubscriptionState(firestore, companyId, subscription)
  await syncSelfServeTier(firestore, companyId, subscription)
}

async function handleSubscriptionDeleted(firestore, subscriptionEventObject) {
  const companyId = subscriptionEventObject.metadata?.companyId
  if (!companyId) return

  await firestore.collection(COMPANIES_COLLECTION).doc(companyId).update({
    billingStatus: 'canceled',
    stripeSubscriptionId: admin.firestore.FieldValue.delete(),
    stripeCoreItemId: admin.firestore.FieldValue.delete(),
    stripePulseCheckItemId: admin.firestore.FieldValue.delete(),
    'featureFlags.pulseCheck': false,
  })
}

// Raw HTTP endpoint (not onCall - Stripe posts here directly, unauthenticated
// by Firebase Auth) that keeps companies/{companyId}'s billing state in sync
// with Stripe. Must be registered as this function's URL in the Stripe
// Dashboard's webhook settings, subscribed to at least: checkout.session.
// completed, customer.subscription.updated, customer.subscription.deleted.
//
// Pilot v1 has no self-serve subscription creation anywhere in this app -
// BillingPage.jsx is read-only plus a "Request a quote" button
// (requestQuote.js), and every real subscription is created by hand once
// sales has negotiated a company's actual (usually discounted) price. This
// webhook's job doesn't change because of that: whatever subscription a
// human sets up still needs its status, item IDs, and Pulse Check
// entitlement flag kept in sync here exactly the same way, including when a
// manually-created subscription later lapses (past_due/unpaid/canceled) -
// this is the only place billingStatus updates after that initial manual
// setup, and it's read by the Super Admin billing-status view in
// SuperAdminDashboardPage.jsx. What changed is only that nothing in this
// codebase calls stripe.checkout.sessions.create or
// stripe.subscriptions.create anymore - this endpoint reacts to Stripe
// state, it never causes it.
//
// Every other event type is acknowledged (200) and ignored - acknowledging
// an event this handler doesn't act on is correct; only a verification
// failure or an error while handling a type it DOES act on returns non-2xx,
// which is what makes Stripe retry.
exports.stripeWebhook = onRequest({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
  const stripe = getStripeClient()
  const signature = req.headers['stripe-signature']

  let event
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, signature, stripeWebhookSecret.value())
  } catch (err) {
    logger.warn('stripeWebhook: signature verification failed', { message: err.message })
    res.status(400).send(`Webhook Error: ${err.message}`)
    return
  }

  const firestore = admin.firestore()

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, firestore, event.data.object)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripe, firestore, event.data.object)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(firestore, event.data.object)
        break
      default:
        break
    }
  } catch (err) {
    logger.error('stripeWebhook: handler error', { type: event.type, message: err.message })
    res.status(500).send('Webhook handler error')
    return
  }

  res.status(200).send({ received: true })
})
