const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  calculateMonthlyPrice,
  calculatePulseCheckAddOnPrice,
  readDeclaredEmployeeCount,
} = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { LINE_ITEM_TAG } = require('./lineItemTags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const QUOTE_REQUESTS_COLLECTION = 'quoteRequests'

// The only way a Company Admin can ask Rectifia for a price, at any
// headcount. Pilot v1 has a handful of founding customers on individually
// negotiated discounts and no self-serve subscription path at all (see
// BillingPage.jsx - there is no "set up billing" button anywhere in the
// app), so this callable is deliberately not gated to a large-company
// threshold the way its predecessor (requestEnterpriseQuote) was. It
// computes the real quote using this module's own copy of Module 29's
// pricing engine (functions/src/billing/pricingEngine.js - the same
// calculateMonthlyPrice() calculateQuote.js uses for its own read-only
// reference quote) and files it as an actual Stripe Quote
// (stripe.quotes.create, left as a draft - never finalized or sent from
// here) against the company's Stripe Customer, in addition to the existing
// quoteRequests/{companyId} Firestore record for Lumora's internal
// follow-up. Sales finalizes and sends the Stripe Quote by hand from the
// Stripe Dashboard once they've reviewed it, and negotiates whatever actual
// price and discount the company ends up on - this callable's job is only
// to get a real, priced Stripe object and an internal record in front of
// them, never to complete a purchase itself. The formula, the brackets, and
// the per-employee rates that produced the number NEVER appear in this
// callable's return value to the client - only a bare confirmation that the
// request was recorded. Once sales has negotiated a price, a human sets up
// the actual Stripe subscription and writes company.stripeSubscriptionId /
// billingStatus / subscriptionTier directly (see stripeWebhook.js's file
// comment) - nothing in this directory creates a subscription anymore.
exports.requestQuote = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, targets: requestedTargets } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only request billing for your own company')
  }
  // Defaults to both - a Company Admin only ever sees a single "Request a
  // quote" button (see BillingPage.jsx), so the common case is asking for
  // Core and Pulse Check together in one Quote.
  const targets = requestedTargets === undefined ? ['core', 'pulseCheck'] : requestedTargets
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.some((target) => target !== 'core' && target !== 'pulseCheck') ||
    new Set(targets).size !== targets.length
  ) {
    throw new HttpsError('invalid-argument', "targets must be a non-empty array of unique values from 'core', 'pulseCheck'")
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'request_quote')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'request_quote',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may request a quote')
  }

  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  const employeeCount = readDeclaredEmployeeCount(company)
  if (employeeCount === null) {
    throw new HttpsError(
      'failed-precondition',
      'Declare your company\'s employee count before requesting a quote'
    )
  }

  // calculateMonthlyPrice() picks the published-band or progressive formula
  // on its own depending on employeeCount, so this reshapes cleanly for any
  // headcount, not just the progressive-formula range. Pulse Check has no
  // separate bracket formula of its own at any headcount - it's always
  // calculatePulseCheckAddOnPrice() - reshaped into the same { tier,
  // monthlyPrice, breakdown } quote shape so both targets store and log
  // identically.
  function quoteForTarget(target) {
    return target === 'core'
      ? calculateMonthlyPrice(employeeCount)
      : {
          tier: 'pulseCheck',
          monthlyPrice: calculatePulseCheckAddOnPrice(employeeCount),
          effectiveRatePerEmployee: null,
          needsManualReview: employeeCount > MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
          breakdown: [{ label: 'Pulse Check', employees: employeeCount, ratePerEmployee: null, amount: calculatePulseCheckAddOnPrice(employeeCount) }],
        }
  }
  const quotesByTarget = Object.fromEntries(targets.map((target) => [target, quoteForTarget(target)]))

  const stripe = getStripeClient()
  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)

  let stripeCustomerId = company.stripeCustomerId
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: company.name,
      metadata: { companyId },
    })
    stripeCustomerId = customer.id
    await companyRef.update({ stripeCustomerId })
  }

  // A real, priced Stripe object for sales to work from - left as a draft
  // (no .finalizeQuote / .sendQuote call here) so nothing is sent to the
  // customer automatically; a human reviews, negotiates, and sends it. One
  // Quote with up to two line items (Core and/or Pulse Check), not two
  // independent Quotes - so that if both get accepted, Stripe creates a
  // single subscription with both items on it, matching the single
  // stripeSubscriptionId field on the company doc. Each line item's
  // product_data is tagged with the shared rectifiaLineItem constant so
  // stripeWebhook.js's applySubscriptionState() can tell Core and Pulse
  // Check apart once the Quote is accepted and becomes a subscription.
  // subscription_data.metadata.companyId carries forward onto that
  // subscription too, which is what lets the webhook find the company at
  // all - without it, handleSubscriptionUpdated silently no-ops forever.
  // The bracket breakdown stays internal (in `quotesByTarget` below and in
  // quoteRequests), never on the Stripe object a customer could eventually
  // see.
  const stripeQuote = await stripe.quotes.create({
    customer: stripeCustomerId,
    line_items: targets.map((target) => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Rectifia - ${target === 'core' ? 'Core plan' : 'Pulse Check add-on'} (${employeeCount} employees)`,
          metadata: { rectifiaLineItem: LINE_ITEM_TAG[target === 'core' ? 'CORE' : 'PULSE_CHECK'] },
        },
        unit_amount: Math.round(quotesByTarget[target].monthlyPrice * 100),
        recurring: { interval: 'month' },
      },
      quantity: 1,
    })),
    subscription_data: { metadata: { companyId } },
    metadata: { companyId, targets: targets.join(','), employeeCountAtRequest: String(employeeCount) },
  })

  const requestsUpdate = Object.fromEntries(
    targets.map((target) => [
      `requests.${target}`,
      {
        employeeCountAtRequest: employeeCount,
        quote: quotesByTarget[target],
        stripeQuoteId: stripeQuote.id,
        requestedByUid: uid,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
      },
    ])
  )

  await firestore
    .collection(QUOTE_REQUESTS_COLLECTION)
    .doc(companyId)
    .set(
      {
        companyId,
        companyName: company.name ?? null,
        ...requestsUpdate,
      },
      { merge: true }
    )

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'request_quote',
    outcome: 'granted',
    detail: targets.join(','),
  })

  // Deliberately bare - no monthlyPrice, no breakdown, no rate. The quote
  // just written above is for Lumora's own sales follow-up only.
  return { requested: true, targets }
})
