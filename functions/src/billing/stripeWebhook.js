const { onRequest } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { stripeSecretKey, stripeWebhookSecret, getStripeClient } = require('./stripeClient')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Tags a Stripe Product's metadata with which of our two billable things a
// subscription item is. Pilot v1 has no self-serve Checkout anymore (see the
// file comment below), so nothing in this codebase creates a Product with
// this tag - a human sets it by hand (or by whatever internal tool
// eventually replaces manual Stripe Dashboard entry) when setting up a
// company's subscription, matching the same values this webhook has always
// looked for.
const LINE_ITEM_TAG = { CORE: 'core', PULSE_CHECK: 'pulseCheck' }

// Writes the effective state of a Stripe subscription onto
// companies/{companyId}: which Stripe objects back it, its status (the same
// vocabulary BillingPage.jsx's BILLING_TONE map already expects - 'active',
// 'trialing', 'past_due', 'canceled', 'unpaid' - plus a couple of Stripe
// statuses that map to companies with money changing hands but no access yet,
// which the badge renders with its tone-neutral fallback), and whether the
// Pulse Check add-on item is present. `subscription` must be freshly
// retrieved with `expand: ['items.data.price.product']` - the webhook event
// payload itself is not trusted for this, both because Stripe's own guidance
// is to treat webhook payloads as a signal to re-fetch rather than a source
// of truth, and because product metadata (how we tell the core item from the
// Pulse Check item, see LINE_ITEM_TAG above) isn't necessarily present on
// the raw event object.
//
// Uses .update(), not .set(..., {merge:true}): companyId always names a
// company that already exists (it only ever comes from metadata a human set
// on the Subscription - or its Checkout Session, if one was used - when
// setting up billing for a real company), so there is no "create if
// missing" case to handle, and .update()'s dotted-string keys are
// unambiguously nested-field paths - the same convention
// companyService.js's updateCompanyFeatureFlag uses client-side. set()+merge's
// handling of a dotted string key as a plain object property is a
// well-known Firestore footgun (it is NOT the same as a field path there),
// so mixing the two patterns is avoided entirely rather than relied on to do
// the right thing.
async function applySubscriptionState(firestore, companyId, subscription) {
  const items = subscription.items?.data ?? []
  const coreItem = items.find((item) => item.price?.product?.metadata?.rectifiaLineItem === LINE_ITEM_TAG.CORE)
  const pulseCheckItem = items.find(
    (item) => item.price?.product?.metadata?.rectifiaLineItem === LINE_ITEM_TAG.PULSE_CHECK
  )

  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id

  const update = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    billingStatus: subscription.status,
    stripeCoreItemId: coreItem ? coreItem.id : admin.firestore.FieldValue.delete(),
  }

  // The Pulse Check add-on's presence on the subscription is the actual
  // purchased state - this is what sets featureFlags.pulseCheck, and is what
  // makes that flag self-healing: however the item got added or removed (a
  // manual change in the Stripe Dashboard when setting up or amending a
  // company's subscription, a failed payment that dropped the item), the
  // next subscription.updated event reconciles the flag to match.
  if (pulseCheckItem) {
    update.stripePulseCheckItemId = pulseCheckItem.id
    update['featureFlags.pulseCheck'] = true
  } else {
    update.stripePulseCheckItemId = admin.firestore.FieldValue.delete()
    update['featureFlags.pulseCheck'] = false
  }

  await firestore.collection(COMPANIES_COLLECTION).doc(companyId).update(update)
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
