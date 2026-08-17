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

const requestQuoteCallable = httpsCallable(functions, 'requestQuote')

// The one billing action a Company Admin can take: ask Rectifia for a real,
// negotiated price at their declared headcount, at any headcount (not
// gated to a large-company threshold). `target` is 'core' or 'pulseCheck'.
// Computes the reference quote server-side, files a real (draft, never
// auto-sent) Stripe Quote object against the company's Stripe Customer, and
// records both for Lumora's own sales follow-up - the response here is
// deliberately just a confirmation ({ requested: true, target }), never a
// price, so no per-employee rate or formula reaches the client.
export async function requestQuote(companyId, { target } = {}) {
  const result = await requestQuoteCallable({ companyId, target })
  return result.data
}
