import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const linkCompanySubscriptionCallable = httpsCallable(functions, 'linkCompanySubscription')

// Super Admin only. Links a Stripe subscription a human already created -
// through an accepted Quote (requestQuote.js) or set up directly in the
// Stripe Dashboard - to a company, or re-links the same/an updated
// subscription to re-sync state and re-label the tier after the negotiated
// plan changed. Never creates a Stripe subscription itself; see
// functions/src/billing/linkCompanySubscription.js for the full contract,
// including its metadata-tag and already-linked-elsewhere checks. Firestore
// itself is never written to directly for any of these fields (see
// firestore.rules' superAdminBillingFieldsLocked()) - this callable, and
// stripeWebhook.js reacting to Stripe, are the only paths.
//
// Returns { billingStatus, subscriptionTier, stripeSubscriptionId } on
// success. Throws with the callable's own message on failure - a missing
// metadata tag or an already-linked-elsewhere subscription - so the caller
// can surface that directly rather than a generic failure.
export async function linkCompanySubscription({ companyId, stripeSubscriptionId, subscriptionTier }) {
  const result = await linkCompanySubscriptionCallable({ companyId, stripeSubscriptionId, subscriptionTier })
  return result.data
}

const getCompanyBillingSummaryCallable = httpsCallable(functions, 'getCompanyBillingSummary')

// Super Admin's read-only counterpart to billingService.js's
// getSubscriptionSummary() - same live-from-Stripe shape, but callable
// against any company rather than only the caller's own. Returns { billed,
// status, corePriceCents, pulseCheckPriceCents, totalPriceCents, currency,
// currentPeriodEnd, employeeCount, employeeCountSource }; `billed` is false
// (with the price fields null and status 'unbilled') for a company with no
// stripeSubscriptionId yet, rather than throwing.
export async function getCompanyBillingSummary(companyId) {
  const result = await getCompanyBillingSummaryCallable({ companyId })
  return result.data
}

const listCompanyPaymentHistoryCallable = httpsCallable(functions, 'listCompanyPaymentHistory')

// The Super Admin billing panel's invoice list - the company's most recent
// Stripe invoices, fetched live on every call. Returns { invoices: [{ id,
// amountPaidCents, currency, status, created, hostedInvoiceUrl, number }] },
// each entry a narrow pre-picked shape rather than the raw Stripe Invoice
// object. Returns an empty list (never throws) for a company with no
// stripeCustomerId yet.
export async function listCompanyPaymentHistory(companyId) {
  const result = await listCompanyPaymentHistoryCallable({ companyId })
  return result.data
}
