const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { calculateMonthlyPrice, calculatePulseCheckAddOnPrice, countActiveEmployees } = require('./pricingEngine')
const { stripeSecretKey, appBaseUrl, getStripeClient } = require('./stripeClient')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Tags each Checkout line item's underlying Stripe Product with which of our
// two billable things it is. Stripe Checkout Sessions don't reliably let you
// tell subscription items apart after the fact by position/order, and this
// app only ever creates two kinds of line item, so a Product-level metadata
// tag is the simplest unambiguous way for stripeWebhook.js and
// syncSubscriptionPricing.js to find "the core plan item" vs. "the Pulse
// Check item" on a subscription without guessing from price or description.
const LINE_ITEM_TAG = { CORE: 'core', PULSE_CHECK: 'pulseCheck' }

function corePriceData(quote) {
  return {
    currency: 'usd',
    product_data: {
      name: `Rectifia - ${quote.tier[0].toUpperCase()}${quote.tier.slice(1)} plan`,
      metadata: { rectifiaLineItem: LINE_ITEM_TAG.CORE },
    },
    unit_amount: Math.round(quote.monthlyPrice * 100),
    recurring: { interval: 'month' },
  }
}

function pulseCheckPriceData(addOnPrice) {
  return {
    currency: 'usd',
    product_data: {
      name: 'Rectifia - Pulse Check add-on',
      metadata: { rectifiaLineItem: LINE_ITEM_TAG.PULSE_CHECK },
    },
    unit_amount: Math.round(addOnPrice * 100),
    recurring: { interval: 'month' },
  }
}

// Starts self-serve billing for a company that doesn't have an active
// subscription yet: returns a Stripe Checkout Session URL for the caller to
// redirect to. There is no plan picker - this app's tier is a function of
// headcount (pricingEngine.js's calculateMonthlyPrice), not something a
// Company Admin selects, so the Checkout line item is always "this
// company's current computed price," created inline via price_data rather
// than a pre-registered Stripe Price. Staying in sync as headcount changes
// afterward is syncSubscriptionPricing.js's job, not this callable's.
//
// Company Admin only - stricter than calculateQuote.js's companyAdmin-or-
// billingView check, because billingView is explicitly documented as
// view-only (src/config/permissionModules.js) and this callable spends the
// company's money.
exports.createBillingCheckoutSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
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
  const role = await loadCallerRole(firestore, companyId, uid, 'create_billing_checkout')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'create_billing_checkout',
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

  if (company.stripeSubscriptionId) {
    throw new HttpsError(
      'already-exists',
      'Billing is already set up for this company. Use the billing portal to make changes, or the Pulse Check toggle to add or remove the add-on.'
    )
  }

  const employeeCount = await countActiveEmployees(firestore, companyId)
  if (employeeCount < 1) {
    throw new HttpsError('failed-precondition', 'Add employees to your roster before setting up billing')
  }

  const quote = calculateMonthlyPrice(employeeCount)
  if (quote.needsManualReview) {
    throw new HttpsError(
      'failed-precondition',
      `At ${employeeCount} employees, pricing is reviewed by the Rectifia sales team rather than self-serve. Contact sales to set up billing.`
    )
  }

  const stripe = getStripeClient()

  let stripeCustomerId = company.stripeCustomerId
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: company.name,
      metadata: { companyId },
    })
    stripeCustomerId = customer.id
    await companyRef.update({ stripeCustomerId })
  }

  const lineItems = [{ price_data: corePriceData(quote), quantity: 1 }]
  if (includePulseCheck) {
    lineItems.push({
      price_data: pulseCheckPriceData(calculatePulseCheckAddOnPrice(employeeCount)),
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
    subscription_data: { metadata: { companyId } },
    metadata: { companyId },
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'create_billing_checkout',
    outcome: 'granted',
    detail: includePulseCheck ? 'with_pulse_check' : 'core_only',
  })

  return { url: session.url }
})

// Exported for togglePulseCheckAddOn.js and syncSubscriptionPricing.js -
// both need to tell the core item and the Pulse Check item on an existing
// subscription apart the same way this file tags them at creation.
exports.LINE_ITEM_TAG = LINE_ITEM_TAG
exports.pulseCheckPriceData = pulseCheckPriceData
exports.corePriceData = corePriceData
