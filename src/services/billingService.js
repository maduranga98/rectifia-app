import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// The only source for a price that should ever be treated as what a company
// is actually billed - it's computed server-side, in
// functions/src/billing/calculateQuote.js, from the company's real active
// roster. src/utils/pricingCalculator.js re-implements the same formula
// client-side, but only for instant what-if UI feedback; it is never called
// here and its output must never be shown as the current, real price.
const calculateQuoteCallable = httpsCallable(functions, 'calculateQuote')

// Returns { employeeCount, quote, pulseCheckAddOnPrice } for the caller's own
// company, where `quote` is { tier, monthlyPrice, effectiveRatePerEmployee,
// needsManualReview, breakdown } or null if the company has no active
// employees on its roster yet.
export async function getCompanyQuote(companyId) {
  const result = await calculateQuoteCallable({ companyId })
  return result.data
}
