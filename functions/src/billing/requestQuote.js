const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  calculateMonthlyPrice,
  calculatePulseCheckAddOnPrice,
  resolveEffectiveEmployeeCount,
} = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { LINE_ITEM_TAG } = require('./lineItemTags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const QUOTE_REQUESTS_COLLECTION = 'quoteRequests'
const NOTIFICATIONS_COLLECTION = 'notifications'

// The shared quote-building core behind both the Company-Admin-initiated
// onCall below and autoGenerateQuoteOnGrowth.js's Firestore trigger:
// resolves the effective employee count, computes the reference quote per
// target via pricingEngine.js, files a real (draft, never finalized) Stripe
// Quote against the company's Stripe Customer, and records the result in
// quoteRequests/{companyId}. `triggeredBy` ('companyAdmin' | 'system') is
// stored on each requests.{target} entry so the record itself says whether
// a human asked for this or the growth trigger fired it - callable-agnostic
// by design so it carries no onCall/auth concerns of its own; the caller is
// responsible for authorizing the request before calling this.
async function generateAndFileQuote(firestore, stripe, { companyId, company, targets, triggeredBy }) {
  const { count: employeeCount } = resolveEffectiveEmployeeCount(company)
  if (employeeCount === null) {
    throw new HttpsError(
      'failed-precondition',
      'Add your employee roster on the Employees page, or declare an estimated employee count, before requesting a quote.'
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
  // Stripe Quotes' price_data doesn't accept inline product_data the way
  // Checkout Sessions and subscription updates do, so each target needs its
  // own real Product created up front - a fresh one per quote request (never
  // reused across requests) since the employee count is baked into the name.
  const stripeProducts = await Promise.all(
    targets.map(async (target) => {
      const product = await stripe.products.create({
        name: `Rectifia - ${target === 'core' ? 'Core plan' : 'Pulse Check add-on'} (${employeeCount} employees)`,
        metadata: { rectifiaLineItem: LINE_ITEM_TAG[target === 'core' ? 'CORE' : 'PULSE_CHECK'] },
      })
      return [target, product.id]
    })
  )
  const productIdByTarget = Object.fromEntries(stripeProducts)

  const stripeQuote = await stripe.quotes.create({
    customer: stripeCustomerId,
    line_items: targets.map((target) => ({
      price_data: {
        currency: 'usd',
        product: productIdByTarget[target],
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
        triggeredBy,
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

  // Lumora-sales-facing only (resolveSuperAdminEmails in
  // deliverNotifications.js) - never the Company Admin who requested it,
  // and never the computed price, same "never leaks the formula to the
  // client" rule this callable's return value already follows. Best-effort:
  // a failure here must never fail the quote request itself, which has
  // already succeeded above. Fires identically regardless of triggeredBy -
  // sales gets the same alert whether a human asked or the growth trigger
  // fired it; only the stored record distinguishes how it originated.
  try {
    await firestore.collection(NOTIFICATIONS_COLLECTION).add({
      type: 'quoteRequested',
      companyId,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      employeeCount,
      stripeQuoteId: stripeQuote.id,
    })
  } catch (err) {
    logger.error('generateAndFileQuote: failed to write quoteRequested notification', {
      companyId,
      error: err.message,
    })
  }

  return { employeeCount, stripeQuote, quotesByTarget }
}

// The only way a Company Admin can ask Rectifia for a price, at any
// headcount. Pilot v1 has a handful of founding customers on individually
// negotiated discounts and no self-serve subscription path at all (see
// BillingPage.jsx - there is no "set up billing" button anywhere in the
// app), so this callable is deliberately not gated to a large-company
// threshold the way its predecessor (requestEnterpriseQuote) was. Auth and
// role checks live here; the actual quote-building work is shared with
// autoGenerateQuoteOnGrowth.js's Firestore trigger via
// generateAndFileQuote() above, so both paths file the same shape of Stripe
// Quote and quoteRequests record, distinguished only by triggeredBy.
exports.generateAndFileQuote = generateAndFileQuote

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
  const targets = requestedTargets == null ? ['core', 'pulseCheck'] : requestedTargets
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

  const stripe = getStripeClient()
  await generateAndFileQuote(firestore, stripe, { companyId, company, targets, triggeredBy: 'companyAdmin' })

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
