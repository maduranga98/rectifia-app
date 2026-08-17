// Shared tag values for the `rectifiaLineItem` metadata key that goes on a
// Stripe Product's metadata, identifying which of our two billable things a
// subscription (or Quote) line item is. requestQuote.js writes this tag on
// every Quote line item's product_data; stripeWebhook.js's
// applySubscriptionState() reads it back off the resulting subscription's
// items (item.price?.product?.metadata?.rectifiaLineItem) to tell the Core
// item from the Pulse Check item. Both sides must use these exact values -
// never a duplicated string literal that can drift.
const LINE_ITEM_TAG = { CORE: 'core', PULSE_CHECK: 'pulseCheck' }

module.exports = { LINE_ITEM_TAG }
