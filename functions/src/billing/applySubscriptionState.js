const admin = require('firebase-admin')
const { LINE_ITEM_TAG } = require('./lineItemTags')

const COMPANIES_COLLECTION = 'companies'

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
// Shared by stripeWebhook.js (reacting to Stripe-initiated changes) and
// linkCompanySubscription.js (a Super Admin manually linking or re-syncing a
// subscription) - both need the exact same reconciliation logic, and this is
// the one place it lives.
//
// Uses .update(), not .set(..., {merge:true}): companyId always names a
// company that already exists (it only ever comes from metadata a human set
// on the Subscription - or its Checkout Session, if one was used - when
// setting up billing for a real company, or from a Super Admin's explicit
// linkCompanySubscription call), so there is no "create if missing" case to
// handle, and .update()'s dotted-string keys are unambiguously nested-field
// paths - the same convention companyService.js's updateCompanyFeatureFlag
// uses client-side. set()+merge's handling of a dotted string key as a plain
// object property is a well-known Firestore footgun (it is NOT the same as
// a field path there), so mixing the two patterns is avoided entirely rather
// than relied on to do the right thing.
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
  // next subscription.updated event (or the next linkCompanySubscription
  // re-sync) reconciles the flag to match.
  if (pulseCheckItem) {
    update.stripePulseCheckItemId = pulseCheckItem.id
    update['featureFlags.pulseCheck'] = true
  } else {
    update.stripePulseCheckItemId = admin.firestore.FieldValue.delete()
    update['featureFlags.pulseCheck'] = false
  }

  await firestore.collection(COMPANIES_COLLECTION).doc(companyId).update(update)
}

module.exports = { applySubscriptionState }
