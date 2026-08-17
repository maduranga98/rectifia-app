const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { PROGRESSIVE_THRESHOLD_EMPLOYEES, bandForEmployeeCount, pulseCheckBandForEmployeeCount } = require('./pricingEngine')
const { stripeSecretKey, appBaseUrl, getStripeClient } = require('./stripeClient')
const { LINE_ITEM_TAG, RECTIFIA_TIER_METADATA_KEY } = require('./lineItemTags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// Starts real self-serve billing for a company at or below the 500-employee
// self-serve ceiling that doesn't have a subscription yet: returns a Stripe
// Checkout Session URL for the caller to redirect to. Company Admin only,
// same reasoning as every other billing callable in this directory - this
// spends the company's money.
//
// Headcount is read from the REAL roster (a count() aggregation against
// companies/{companyId}/employees), never the self-declared
// company.employeeCount pricingEngine.js's readDeclaredEmployeeCount() feeds
// the reference-quote-only calculateQuote.js/requestQuote.js path - an
// actual subscription must be priced off what the roster actually contains,
// not what a Company Admin typed into a form.
//
// Builds one Checkout Session with up to two line items (Core, always; Pulse
// Check, only if includePulseCheck is true) so an accepted checkout produces
// ONE subscription with both items on it - the same single-subscription
// shape requestQuote.js's Stripe Quote produces, and the fix for the
// two-subscriptions problem an earlier draft of self-serve billing (Module
// 29F) had when Core and Pulse Check were purchased as separate Checkout
// Sessions. The Core item's product is tagged with both rectifiaLineItem
// (so applySubscriptionState() can find it) and rectifiaTier (so
// stripeWebhook.js can keep company.subscriptionTier in sync once checkout
// completes - see lineItemTags.js).
exports.createCheckoutSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, includePulseCheck } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'create_checkout_session')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'create_checkout_session',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may set up billing for this company')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  // A company that already has a subscription must go through the billing
  // portal or updatePulseCheckSubscription.js/upgradeSubscriptionTier.js to
  // change plans - never a second Checkout Session, which would leave the
  // company with two live subscriptions and only one stripeSubscriptionId
  // field to record either of them in.
  if (company.stripeSubscriptionId) {
    throw new HttpsError(
      'already-exists',
      'Billing is already set up for this company. Use the billing portal, the Pulse Check toggle, or the Upgrade action to make changes.'
    )
  }

  const countSnapshot = await companyRef.collection(EMPLOYEES_SUBCOLLECTION).count().get()
  const employeeCount = countSnapshot.data().count

  // Above the self-serve ceiling, this callable must never touch the
  // company - route to requestQuote.js's Contact sales flow instead (the
  // same threshold and the same two callables Modules 29F/29G already split
  // this way).
  if (employeeCount > PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    throw new HttpsError(
      'failed-precondition',
      `Self-serve checkout isn't available above ${PROGRESSIVE_THRESHOLD_EMPLOYEES} employees - request a quote instead.`
    )
  }
  if (employeeCount < 1) {
    throw new HttpsError('failed-precondition', 'Add employees to your roster before subscribing')
  }

  const band = bandForEmployeeCount(employeeCount)

  const stripe = getStripeClient()
  let stripeCustomerId = company.stripeCustomerId
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({ name: company.name, metadata: { companyId } })
    stripeCustomerId = customer.id
    await companyRef.update({ stripeCustomerId })
  }

  const lineItems = [
    {
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Rectifia - ${band.label} plan`,
          metadata: { rectifiaLineItem: LINE_ITEM_TAG.CORE, [RECTIFIA_TIER_METADATA_KEY]: band.tier },
        },
        unit_amount: Math.round(band.monthlyPrice * 100),
        recurring: { interval: 'month' },
      },
      quantity: 1,
    },
  ]

  if (includePulseCheck) {
    const pulseCheckBand = pulseCheckBandForEmployeeCount(employeeCount)
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Rectifia - Pulse Check add-on',
          metadata: { rectifiaLineItem: LINE_ITEM_TAG.PULSE_CHECK },
        },
        unit_amount: Math.round(pulseCheckBand.monthlyPrice * 100),
        recurring: { interval: 'month' },
      },
      quantity: 1,
    })
  }

  const base = appBaseUrl.value().replace(/\/+$/, '')
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: lineItems,
    success_url: `${base}/admin/billing?checkout=success`,
    cancel_url: `${base}/admin/billing?checkout=cancelled`,
    // Matches the pattern requestQuote.js's Stripe Quote already fixes:
    // this metadata carries forward onto the resulting subscription, which
    // is what lets stripeWebhook.js's handleCheckoutCompleted find the
    // company at all.
    subscription_data: { metadata: { companyId } },
    metadata: { companyId },
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'create_checkout_session',
    outcome: 'granted',
    detail: includePulseCheck ? 'with_pulse_check' : 'core_only',
  })

  return { url: session.url }
})
