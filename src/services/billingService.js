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

const createCheckoutSessionCallable = httpsCallable(functions, 'createBillingCheckoutSession')
const togglePulseCheckAddOnCallable = httpsCallable(functions, 'togglePulseCheckAddOn')
const createBillingPortalSessionCallable = httpsCallable(functions, 'createBillingPortalSession')

// Starts self-serve billing for a company with no active subscription yet.
// Returns { url } - a Stripe Checkout Session URL the caller should redirect
// the browser to (`window.location.href = url`), never opened as an embedded
// form. `includePulseCheck` adds the add-on as a second line item on the
// same Checkout instead of requiring a separate purchase afterward. Throws
// if the company already has a subscription (use togglePulseCheckAddOn or
// openBillingPortal instead) or is above the manual-sales-review headcount.
export async function startBillingCheckout(companyId, { includePulseCheck = false } = {}) {
  const result = await createCheckoutSessionCallable({ companyId, includePulseCheck })
  return result.data
}

// Adds (enable: true) or removes (enable: false) the Pulse Check add-on on a
// company's existing subscription - requires startBillingCheckout to have
// run at least once already. Returns { pulseCheckEnabled }. This is the paid
// counterpart to a Super Admin's manual featureFlags.pulseCheck override in
// FeatureFlagPanel.jsx: this call is what a Company Admin uses to actually
// buy or cancel the add-on themselves.
export async function togglePulseCheckAddOn(companyId, enable) {
  const result = await togglePulseCheckAddOnCallable({ companyId, enable })
  return result.data
}

// Returns { url } for the Stripe-hosted Billing Portal (payment method,
// invoices, cancellation) for a company that already has a Stripe customer.
export async function openBillingPortal(companyId) {
  const result = await createBillingPortalSessionCallable({ companyId })
  return result.data
}

const upgradeSubscriptionCallable = httpsCallable(functions, 'upgradeSubscription')
const requestEnterpriseQuoteCallable = httpsCallable(functions, 'requestEnterpriseQuote')

// Package-selection UI (PackageSelector.jsx / PulseCheckToggle.jsx): a
// self-declared entitlement track, entirely separate from the Stripe-driven
// functions above - it never creates a charge or touches billingStatus. See
// functions/src/billing/upgradeSubscription.js for the full reasoning.
//
// Instant, self-serve Core plan or Pulse Check band change for a company at
// or below the 500-employee self-serve threshold - the server independently
// re-validates that the selected band actually matches the company's
// declared employeeCount before writing anything, so a client cannot select
// a band its headcount doesn't qualify for.
//
// `target` is 'core' or 'pulseCheck'. For 'core', `tier` is required (one of
// 'starter' | 'growth' | 'scale'). For 'pulseCheck', pass `tier` to turn the
// add-on on at that band, or `enable: false` to turn it off (no tier needed
// to disable). Returns { target, tier, enabled? }.
export async function upgradeSubscription(companyId, { target, tier, enable } = {}) {
  const result = await upgradeSubscriptionCallable({ companyId, target, tier, enable })
  return result.data
}

// The "Contact sales" path for a company above the 500-employee self-serve
// threshold. `target` is 'core' or 'pulseCheck'. Computes the real quote
// server-side and files it for Lumora's own follow-up - the response here
// is deliberately just a confirmation ({ requested: true, target }), never
// a price, so no per-employee rate or formula reaches the client.
export async function requestEnterpriseQuote(companyId, { target } = {}) {
  const result = await requestEnterpriseQuoteCallable({ companyId, target })
  return result.data
}
