// Shared tag values for the `rectifiaLineItem` metadata key that goes on a
// Stripe Product's metadata, identifying which of our two billable things a
// subscription (or Quote) line item is. requestQuote.js writes this tag on
// every Quote line item's product_data; stripeWebhook.js's
// applySubscriptionState() reads it back off the resulting subscription's
// items (item.price?.product?.metadata?.rectifiaLineItem) to tell the Core
// item from the Pulse Check item. Both sides must use these exact values -
// never a duplicated string literal that can drift.
const LINE_ITEM_TAG = { CORE: 'core', PULSE_CHECK: 'pulseCheck' }

// Product metadata key carrying the PUBLISHED_BANDS tier ('starter'/'growth'/
// 'scale') a self-serve Core line item was created at - written by
// createCheckoutSession.js and upgradeSubscriptionTier.js alongside
// rectifiaLineItem, and read back by stripeWebhook.js so it can keep
// companies/{companyId}.subscriptionTier in sync for a self-serve
// subscription the same way applySubscriptionState() keeps billingStatus and
// the item IDs in sync. Absent on a manually-negotiated subscription set up
// via requestQuote.js/linkCompanySubscription.js - those set subscriptionTier
// by hand instead (see linkCompanySubscription.js), and the webhook simply
// finds no tag to act on there.
const RECTIFIA_TIER_METADATA_KEY = 'rectifiaTier'

module.exports = { LINE_ITEM_TAG, RECTIFIA_TIER_METADATA_KEY }
