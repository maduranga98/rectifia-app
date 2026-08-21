const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { LINE_ITEM_TAG } = require('./lineItemTags')
const { resolveEffectiveEmployeeCount } = require('./pricingEngine')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const SUPER_ADMINS_COLLECTION = 'superAdmins'

// Same allowlist check as linkCompanySubscription.js's requireSuperAdmin -
// Super Admin is membership at superAdmins/{uid}, not a custom claim. Kept
// as its own local copy rather than a shared helper, matching every other
// billing callable in this directory that needs it.
async function requireSuperAdmin(actorUid) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Super Admin to view company billing')
  }
  const snapshot = await admin.firestore().collection(SUPER_ADMINS_COLLECTION).doc(actorUid).get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can view this company\'s billing summary')
  }
}

// Super Admin's read-only counterpart to getSubscriptionSummary.js (which is
// Company-Admin-scoped, self-company only): the same live Stripe read -
// `expand: ['items.data.price.product']`, split into core/pulseCheck via the
// shared LINE_ITEM_TAG product metadata lookup - but callable against ANY
// company, for the Super Admin billing panel. Never cached on the company
// doc; fetched fresh from Stripe on every call, same convention as every
// other billing summary in this directory.
//
// A company with no stripeSubscriptionId yet returns a clear "not billed"
// shape instead of throwing, so CompanyBillingSummary.jsx can render an
// empty state rather than treating a brand-new company as an error.
exports.getCompanyBillingSummary = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = request.auth?.uid
  await requireSuperAdmin(uid)

  const { companyId } = request.data || {}
  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }

  const firestore = admin.firestore()
  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  const { count: employeeCount, source: employeeCountSource } = resolveEffectiveEmployeeCount(company)

  const stripeSubscriptionId = company?.stripeSubscriptionId
  if (!stripeSubscriptionId) {
    return {
      billed: false,
      status: 'unbilled',
      corePriceCents: null,
      pulseCheckPriceCents: null,
      totalPriceCents: null,
      currency: null,
      currentPeriodEnd: null,
      employeeCount,
      employeeCountSource,
    }
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

  return {
    billed: true,
    status: subscription.status,
    corePriceCents,
    pulseCheckPriceCents,
    totalPriceCents,
    currency,
    currentPeriodEnd: subscription.current_period_end ?? null,
    employeeCount,
    employeeCountSource,
  }
})
