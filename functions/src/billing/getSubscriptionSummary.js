const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { LINE_ITEM_TAG } = require('./lineItemTags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// The one place an active subscriber can see what they're actually being
// charged, in-app - always fetched live from Stripe (same `expand:
// ['items.data.price.product']` shape applySubscriptionState.js uses),
// never from cached Firestore fields, so a Dashboard-side price change
// shows up immediately without waiting on a webhook round-trip. Splits
// items into core/pulseCheck the same way applySubscriptionState.js does,
// via the shared LINE_ITEM_TAG product metadata lookup. Returns bare
// numbers a customer is entitled to see about their own subscription -
// never a Stripe price/product ID or any bracket/formula detail, which
// stay server-side (see calculateQuote.js/pricingEngine.js for why).
//
// Company Admin only, same reasoning as the other billing callables in
// this directory.
exports.getSubscriptionSummary = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { companyId } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only view billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'get_subscription_summary')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'get_subscription_summary',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may view this company\'s subscription summary')
  }

  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  const stripeSubscriptionId = companySnapshot.data()?.stripeSubscriptionId
  if (!stripeSubscriptionId) {
    throw new HttpsError('failed-precondition', 'No active subscription to summarize')
  }

  const stripe = getStripeClient()
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['items.data.price.product'],
  })

  const items = subscription.items?.data ?? []
  const coreItem = items.find((item) => item.price?.product?.metadata?.rectifiaLineItem === LINE_ITEM_TAG.CORE)
  const pulseCheckItem = items.find(
    (item) => item.price?.product?.metadata?.rectifiaLineItem === LINE_ITEM_TAG.PULSE_CHECK
  )

  const corePriceCents = coreItem ? (coreItem.price?.unit_amount ?? 0) * (coreItem.quantity ?? 1) : 0
  const pulseCheckPriceCents = pulseCheckItem
    ? (pulseCheckItem.price?.unit_amount ?? 0) * (pulseCheckItem.quantity ?? 1)
    : null

  const totalPriceCents = items.reduce(
    (sum, item) => sum + (item.price?.unit_amount ?? 0) * (item.quantity ?? 1),
    0
  )

  const currency = subscription.currency ?? items[0]?.price?.currency ?? 'usd'

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'get_subscription_summary',
    outcome: 'granted',
  })

  return {
    currency,
    corePriceCents,
    pulseCheckPriceCents,
    totalPriceCents,
    currentPeriodEnd: subscription.current_period_end ?? null,
    status: subscription.status,
  }
})
