const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { PROGRESSIVE_THRESHOLD_EMPLOYEES, bandForEmployeeCount } = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { applySubscriptionState } = require('./applySubscriptionState')
const { LINE_ITEM_TAG, RECTIFIA_TIER_METADATA_KEY } = require('./lineItemTags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'
const BILLING_HISTORY_SUBCOLLECTION = 'billingHistory'

// Explicit, Company-Admin-initiated Core tier change - never triggered
// silently as a side effect of adding an employee. addEmployee.js /
// bulkAddEmployees.js only ever block with a headcount_cap_reached error;
// this is the separate action a Company Admin takes in response to that
// error (EmployeesPage.jsx's "Upgrade to Growth" prompt), never something
// that fires automatically on their behalf.
//
// Moves the Core subscription item to the PUBLISHED_BANDS tier that covers
// the roster's REAL current headcount plus one - the band that actually
// fits the employee the cap just blocked - rather than a tier the client
// names, so the target can't be manipulated from the client into a band the
// company's roster doesn't justify.
exports.upgradeSubscriptionTier = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { companyId } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'upgrade_subscription_tier')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'upgrade_subscription_tier',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may change the subscription plan')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  if (!company.stripeSubscriptionId || !company.stripeCoreItemId) {
    throw new HttpsError('failed-precondition', 'Set up billing before changing your plan')
  }

  const countSnapshot = await companyRef.collection(EMPLOYEES_SUBCOLLECTION).count().get()
  const employeeCount = countSnapshot.data().count

  if (employeeCount + 1 > PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    throw new HttpsError(
      'failed-precondition',
      `Self-serve plan changes aren't available above ${PROGRESSIVE_THRESHOLD_EMPLOYEES} employees - request a quote instead.`
    )
  }

  const band = bandForEmployeeCount(employeeCount + 1)
  const previousTier = company.subscriptionTier ?? null
  if (band.tier === previousTier) {
    throw new HttpsError('failed-precondition', `Your plan is already ${band.label} - no upgrade needed`)
  }

  const stripe = getStripeClient()
  const item = await stripe.subscriptionItems.retrieve(company.stripeCoreItemId, { expand: ['price.product'] })
  const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id

  await stripe.products.update(productId, {
    name: `Rectifia - ${band.label} plan`,
    metadata: { rectifiaLineItem: LINE_ITEM_TAG.CORE, [RECTIFIA_TIER_METADATA_KEY]: band.tier },
  })
  // Default proration_behavior ('create_prorations') is intentional - this
  // is a discrete action a Company Admin just took, not a background sync.
  await stripe.subscriptionItems.update(company.stripeCoreItemId, {
    price_data: {
      currency: 'usd',
      product: productId,
      unit_amount: Math.round(band.monthlyPrice * 100),
      recurring: { interval: 'month' },
    },
  })

  // Re-syncs billingStatus/item IDs/featureFlags.pulseCheck from the live
  // subscription (applySubscriptionState() doesn't touch subscriptionTier -
  // see its own file comment - so that field is written explicitly right
  // after, the same two-step linkCompanySubscription.js already uses).
  const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId, {
    expand: ['items.data.price.product'],
  })
  await applySubscriptionState(firestore, companyId, subscription)
  await companyRef.update({ subscriptionTier: band.tier })

  await companyRef.collection(BILLING_HISTORY_SUBCOLLECTION).add({
    action: 'core_tier_upgrade',
    changedByUid: uid,
    changedByRole: role,
    fromTier: previousTier,
    toTier: band.tier,
    employeeCountAtChange: employeeCount,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'upgrade_subscription_tier',
    outcome: 'granted',
    detail: `${previousTier ?? 'none'}->${band.tier}`,
  })

  return { subscriptionTier: band.tier, cap: band.maxEmployees }
})
