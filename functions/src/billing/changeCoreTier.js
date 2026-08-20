const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { applySubscriptionState } = require('./applySubscriptionState')
const { LINE_ITEM_TAG, RECTIFIA_TIER_METADATA_KEY } = require('./lineItemTags')

const BILLING_HISTORY_SUBCOLLECTION = 'billingHistory'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Shared Core-item mover: renames the Stripe product, reprices the
// subscription item to `newBand`'s rate, reconciles Firestore via
// applySubscriptionState() + the explicit subscriptionTier write (same
// two-step linkCompanySubscription.js already uses, since
// applySubscriptionState() never touches subscriptionTier itself), and logs
// one billingHistory entry. Extracted out of upgradeSubscriptionTier.js so
// updateDeclaredHeadcount.js can drive the exact same Stripe/Firestore
// mechanics for a declared-count company - the two callers differ only in
// how they decide `newBand` (the roster cap vs. a re-declared headcount) and
// in which direction they're allowed to move (up-only vs. up-or-down), never
// in what actually changing tiers means once a target band is chosen.
//
// `company` must already carry stripeCoreItemId/stripeSubscriptionId - the
// caller is responsible for that precondition check, since the two error
// messages ("set up billing before...") differ slightly between callers.
// `extra` is merged into the billingHistory entry so each caller can log its
// own change-specific fields (upgradeSubscriptionTier.js's
// employeeCountAtChange, updateDeclaredHeadcount.js's newCount) without this
// shared function needing to know their shapes.
async function changeCoreTier(firestore, stripe, companyRef, company, newBand, { action, changedByUid, changedByRole, extra }) {
  const previousTier = company.subscriptionTier ?? null

  const item = await stripe.subscriptionItems.retrieve(company.stripeCoreItemId, { expand: ['price.product'] })
  const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id

  await stripe.products.update(productId, {
    name: `Rectifia - ${newBand.label} plan`,
    metadata: { rectifiaLineItem: LINE_ITEM_TAG.CORE, [RECTIFIA_TIER_METADATA_KEY]: newBand.tier },
  })
  // Default proration_behavior ('create_prorations') is intentional - this is
  // a discrete action a Company Admin just took, not a background sync.
  await stripe.subscriptionItems.update(company.stripeCoreItemId, {
    price_data: {
      currency: 'usd',
      product: productId,
      unit_amount: Math.round(newBand.monthlyPrice * 100),
      recurring: { interval: 'month' },
    },
  })

  const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId, {
    expand: ['items.data.price.product'],
  })
  await applySubscriptionState(firestore, companyRef.id, subscription)
  await companyRef.update({ subscriptionTier: newBand.tier })

  await companyRef.collection(BILLING_HISTORY_SUBCOLLECTION).add({
    action,
    changedByUid,
    changedByRole,
    fromTier: previousTier,
    toTier: newBand.tier,
    ...extra,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Company-facing (companyAdmin role) - previousTier/newTier/action only,
  // no price data (that's already visible on BillingPage.jsx). Shared by
  // both upgradeSubscriptionTier.js and updateDeclaredHeadcount.js, so both
  // callers get this notification for free. Best-effort: a failure here must
  // never fail the tier change itself, which has already succeeded above.
  try {
    await firestore.collection(NOTIFICATIONS_COLLECTION).add({
      type: 'coreTierChanged',
      companyId: companyRef.id,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      previousTier,
      newTier: newBand.tier,
      action,
    })
  } catch (err) {
    logger.error('changeCoreTier: failed to write coreTierChanged notification', {
      companyId: companyRef.id,
      error: err.message,
    })
  }

  return { previousTier, tier: newBand.tier }
}

module.exports = { changeCoreTier }
