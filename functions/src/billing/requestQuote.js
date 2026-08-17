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
  const { companyId, target } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only request billing for your own company')
  }
  if (target !== 'core' && target !== 'pulseCheck') {
    throw new HttpsError('invalid-argument', "target must be 'core' or 'pulseCheck'")
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
  const quote =
    target === 'core'
      ? calculateMonthlyPrice(employeeCount)
      : {
          tier: 'pulseCheck',
          monthlyPrice: calculatePulseCheckAddOnPrice(employeeCount),
          effectiveRatePerEmployee: null,
          needsManualReview: employeeCount > MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
          breakdown: [{ label: 'Pulse Check', employees: employeeCount, ratePerEmployee: null, amount: calculatePulseCheckAddOnPrice(employeeCount) }],
        }

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
  // line item at the reference monthlyPrice - the bracket breakdown stays
  // internal (in `quote` below and in quoteRequests), never on the Stripe
  // object a customer could eventually see.
  const stripeQuote = await stripe.quotes.create({
    customer: stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Rectifia - ${target === 'core' ? 'Core plan' : 'Pulse Check add-on'} (${employeeCount} employees)`,
          },
          unit_amount: Math.round(quote.monthlyPrice * 100),
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    metadata: { companyId, target, employeeCountAtRequest: String(employeeCount) },
  })

  await firestore
    .collection(QUOTE_REQUESTS_COLLECTION)
    .doc(companyId)
    .set(
      {
        companyId,
        companyName: company.name ?? null,
        [`requests.${target}`]: {
          employeeCountAtRequest: employeeCount,
          quote,
          stripeQuoteId: stripeQuote.id,
          requestedByUid: uid,
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
        },
      },
      { merge: true }
    )

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'request_quote',
    outcome: 'granted',
    detail: target,
  })

  // Deliberately bare - no monthlyPrice, no breakdown, no rate. The quote
  // just written above is for Lumora's own sales follow-up only.
  return { requested: true, target }
})
