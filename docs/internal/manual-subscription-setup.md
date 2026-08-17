# Manual subscription setup (Stripe)

Pilot v1 has no self-serve checkout. Every real subscription is either the
result of a Company Admin's "Request a quote" click getting finalized and
accepted, or a subscription a staff member builds by hand in the Stripe
Dashboard. This doc covers both paths and what, if anything, staff need to
do by hand in each one.

Background: `functions/src/billing/stripeWebhook.js` keeps
`companies/{companyId}`'s billing fields (`stripeSubscriptionId`,
`billingStatus`, `stripeCoreItemId`, `stripePulseCheckItemId`,
`featureFlags.pulseCheck`) in sync with Stripe. It does this by reading two
pieces of metadata off the subscription it's syncing:

- `subscription.metadata.companyId` - tells the webhook *which* company this
  subscription belongs to. No `companyId` metadata, no sync, ever - the
  webhook silently no-ops on that subscription's events forever.
- `item.price.product.metadata.rectifiaLineItem` (`'core'` or
  `'pulseCheck'`, see `functions/src/billing/lineItemTags.js`) on each line
  item's **product** - tells the webhook which item is the Core plan and
  which is the Pulse Check add-on. Without it, `stripeCoreItemId` /
  `stripePulseCheckItemId` never populate and `featureFlags.pulseCheck`
  never flips true, even on a subscription that's otherwise perfectly set
  up.

## Path A: Quote acceptance (preferred)

This is what happens when a Company Admin clicks "Request a quote" on
Billing and sales works the resulting Stripe Quote.

1. The app calls `requestQuote` (`functions/src/billing/requestQuote.js`),
   which creates a single Stripe Quote against the company's Stripe
   Customer, with one line item per requested plan (Core and/or Pulse
   Check). It is left as a **draft** - nothing is sent to the customer
   automatically.
2. Both line items' product metadata are already tagged with
   `rectifiaLineItem` (`core` / `pulseCheck`), and the Quote's
   `subscription_data.metadata.companyId` is already set to the company's
   ID. Both of these carry forward automatically onto the subscription
   Stripe creates when the Quote is accepted.
3. **Staff action required:** open the Quote in the Stripe Dashboard, edit
   the line item price(s) to the actual negotiated (often discounted) rate,
   then finalize and send it to the customer. That's the only manual step -
   there is no metadata to add by hand.
4. Once the customer accepts the Quote, Stripe creates the subscription and
   fires `customer.subscription.updated` (and/or
   `checkout.session.completed`). `stripeWebhook.js` picks it up
   automatically - `company.stripeSubscriptionId`, `billingStatus`, the two
   item IDs, and `featureFlags.pulseCheck` all populate themselves. No
   further manual write is needed on this path.

The `quoteRequests/{companyId}` Firestore document written alongside the
Stripe Quote is unrelated to any of the above - it's purely Lumora's
internal sales follow-up log (who asked, at what headcount, when) and isn't
read by the webhook or the billing sync at all.

## Path B: Subscription created by hand in the Dashboard

Use this only when bypassing the Quote flow entirely (e.g. a subscription
set up before a Quote existed, or built directly in the Dashboard for some
other reason). Because this path never goes through `requestQuote.js`,
none of the metadata in Path A is set automatically - it must be entered by
hand, or the webhook will never pick this subscription up.

In the Stripe Dashboard:

1. **Add `companyId` metadata to the subscription itself.**
   Customers → open the customer → Subscriptions → open the subscription →
   **Metadata** section (right-hand panel) → **Add metadata** → key
   `companyId`, value the company's Firestore document ID (the same ID used
   as `companies/{companyId}`). This must be on the **subscription** object,
   not the customer or an invoice.

2. **Add `rectifiaLineItem` metadata to each line item's product.**
   For each subscription item (Core, Pulse Check, or both): click into the
   item's **Price**, then into the **Product** it belongs to → **Metadata**
   section → **Add metadata** → key `rectifiaLineItem`, value `core` for
   the Core plan's product or `pulseCheck` for the Pulse Check add-on's
   product (values from `functions/src/billing/lineItemTags.js` -
   `LINE_ITEM_TAG.CORE` / `LINE_ITEM_TAG.PULSE_CHECK`). This is metadata on
   the **Product**, not the Price and not the subscription item - a
   product used for both a Quote-driven item and a hand-built one only
   needs to be tagged once, since the tag lives on the shared product.

3. **Fallback: write the company doc fields by hand too.** Even after step
   1-2, still write `company.stripeSubscriptionId`, `billingStatus`, and
   `subscriptionTier` directly on `companies/{companyId}` as the existing
   documented process describes, in case the metadata gets missed or the
   webhook doesn't fire for some reason. Treat the webhook as a
   self-healing safety net on this path, not as the primary mechanism - the
   Dashboard fields are still the source of truth for the initial write.

If you're unsure whether a subscription in the Dashboard already has this
metadata, check the subscription's **Metadata** panel and each line item
product's **Metadata** panel directly - there's no other way to tell short
of inspecting `companies/{companyId}` in Firestore afterward.
