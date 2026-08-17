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
