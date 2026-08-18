import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// The only source for a price that should ever be shown as a REFERENCE for
// what a company might pay - it's computed server-side, in
// functions/src/billing/calculateQuote.js, from Rectifia's published rates
// and the company's declared headcount. Pilot v1 has no self-serve
// subscription path: this is never what a real customer is actually
// billed - see BillingQuote.jsx's "reference rate" framing, which must stay
// attached to anywhere this is shown. src/utils/pricingCalculator.js
// re-implements the same formula client-side, but only for instant what-if
// UI feedback; it is never called here.
const calculateQuoteCallable = httpsCallable(functions, 'calculateQuote')

// Returns { employeeCount, quote, pulseCheckAddOnPrice } for the caller's own
// company, where `quote` is { tier, monthlyPrice, effectiveRatePerEmployee,
// needsManualReview, breakdown } or null if the company has no declared
// employeeCount yet.
export async function getCompanyQuote(companyId) {
  const result = await calculateQuoteCallable({ companyId })
  return result.data
}

const createBillingPortalSessionCallable = httpsCallable(functions, 'createBillingPortalSession')

// Returns { url } for the Stripe-hosted Billing Portal (payment method,
// invoices, cancellation) for a company that already has a Stripe customer -
// i.e. one whose subscription a human has already set up directly against
// Stripe after negotiating pricing. There is no self-serve "set up billing"
// counterpart to this function; a company with no subscription yet has
// nothing to open a portal for.
export async function openBillingPortal(companyId) {
  const result = await createBillingPortalSessionCallable({ companyId })
  return result.data
}

const getSubscriptionSummaryCallable = httpsCallable(functions, 'getSubscriptionSummary')

// The live, actually-charged price for a company that already has a Stripe
// subscription - fetched fresh from Stripe on every call
// (getSubscriptionSummary.js never trusts cached Firestore price data, and
// this never caches the result either), unlike getCompanyQuote() above,
// which is always a reference-only formula. Returns { currency,
// corePriceCents, pulseCheckPriceCents (null if no Pulse Check item),
// totalPriceCents, currentPeriodEnd, status } - bare numbers only, never a
// Stripe price/product ID or the bracket/formula behind them. Throws if the
// company has no stripeSubscriptionId yet; BillingQuote.jsx's
// ActiveSubscriptionSummary only calls this once it knows one exists.
export async function getSubscriptionSummary(companyId) {
  const result = await getSubscriptionSummaryCallable({ companyId })
  return result.data
}

const requestQuoteCallable = httpsCallable(functions, 'requestQuote')

// The one billing action a Company Admin can take: ask Rectifia for a real,
// negotiated price at their declared headcount, at any headcount (not
// gated to a large-company threshold). `targets` is an array drawn from
// 'core' / 'pulseCheck' and defaults to both - requestQuote.js builds a
// single Stripe Quote with one line item per requested target, so that an
// accepted Quote produces one subscription, matching the single
// stripeSubscriptionId field on the company doc. Computes the reference
// quote server-side, files a real (draft, never auto-sent) Stripe Quote
// object against the company's Stripe Customer, and records it for
// Lumora's own sales follow-up - the response here is deliberately just a
// confirmation ({ requested: true, targets }), never a price, so no
// per-employee rate or formula reaches the client.
export async function requestQuote(companyId, { targets } = {}) {
  const result = await requestQuoteCallable({ companyId, targets })
  return result.data
}

const createCheckoutSessionCallable = httpsCallable(functions, 'createCheckoutSession')

// Real self-serve billing for a company at or below the 500-employee
// self-serve ceiling with no subscription yet - returns { url } for a Stripe
// Checkout Session to redirect to. Unlike requestQuote() above, this
// actually starts a paid subscription: the price is computed server-side
// from the company's REAL roster headcount, never the self-declared
// employeeCount BillingQuote.jsx's reference quote uses. Refuses outright
// (createCheckoutSession.js) if a subscription already exists or the roster
// is above the self-serve ceiling - BillingPage.jsx keeps requestQuote()'s
// "Contact sales" flow as the only path in both of those cases.
export async function createCheckoutSession(companyId, { includePulseCheck = false } = {}) {
  const result = await createCheckoutSessionCallable({ companyId, includePulseCheck })
  return result.data
}

const updatePulseCheckSubscriptionCallable = httpsCallable(functions, 'updatePulseCheckSubscription')

// Adds or removes the Pulse Check add-on on a company's EXISTING self-serve
// subscription. Only meaningful once createCheckoutSession() above has run
// once - see updatePulseCheckSubscription.js for the full precondition set.
export async function updatePulseCheckSubscription(companyId, enable) {
  const result = await updatePulseCheckSubscriptionCallable({ companyId, enable })
  return result.data
}

const upgradeSubscriptionTierCallable = httpsCallable(functions, 'upgradeSubscriptionTier')

// The explicit "Upgrade to Growth"-style action a Company Admin takes after
// hitting the headcount cap (EmployeesPage.jsx's headcount_cap_reached
// prompt) - never triggered automatically by adding an employee. Moves the
// Core item to the band that fits the roster's real headcount plus one; see
// upgradeSubscriptionTier.js for why the target tier is computed server-side
// rather than named by the client.
export async function upgradeSubscriptionTier(companyId) {
  const result = await upgradeSubscriptionTierCallable({ companyId })
  return result.data
}

const updateDeclaredHeadcountCallable = httpsCallable(functions, 'updateDeclaredHeadcount')

// The declared-count counterpart of upgradeSubscriptionTier() above: for a
// company whose subscription is priced from a self-declared headcount
// (company.billingHeadcountSource === 'declared', set at checkout by
// createCheckoutSession.js), re-declares that number and, if it now falls in
// a different PUBLISHED_BANDS tier, moves the Core item up OR down to match.
// Refuses outright (updateDeclaredHeadcount.js) for a roster-priced company -
// that company's only tier-movement path is upgradeSubscriptionTier().
// `attested` is always sent as true - the UI's own checkbox is what gates
// whether this function ever gets called at all, so there is no case where
// this wrapper is invoked without the Company Admin having just confirmed
// the number.
export async function updateDeclaredHeadcount(companyId, newCount) {
  const result = await updateDeclaredHeadcountCallable({ companyId, newCount, attested: true })
  return result.data
}
