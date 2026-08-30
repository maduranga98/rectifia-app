const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { applySubscriptionState, syncSelfServeTier } = require('./applySubscriptionState')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Stripe subscription statuses that mean "this subscription is the company's
// current one", best first. A 'canceled'/'incomplete_expired' subscription is
// never adopted here - those are dead objects from an abandoned or ended
// checkout, and adopting one would write a stripeSubscriptionId that
// createCheckoutSession.js then refuses to let the company replace.
const ADOPTABLE_STATUS_PRIORITY = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete']

// Picks the subscription a just-completed Checkout most likely produced:
// the best-status one, and among equals the most recently created.
function pickCurrentSubscription(subscriptions) {
  const adoptable = subscriptions.filter((subscription) =>
    ADOPTABLE_STATUS_PRIORITY.includes(subscription.status)
  )
  if (adoptable.length === 0) return null
  adoptable.sort((a, b) => {
    const rank = ADOPTABLE_STATUS_PRIORITY.indexOf(a.status) - ADOPTABLE_STATUS_PRIORITY.indexOf(b.status)
    if (rank !== 0) return rank
    return (b.created ?? 0) - (a.created ?? 0)
  })
  return adoptable[0]
}

// Reconciles companies/{companyId} with Stripe on demand, for the caller's
// own company - the return leg of self-serve checkout.
//
// createCheckoutSession.js sends a Company Admin off to Stripe, and Stripe
// sends them straight back to /admin/billing?checkout=success. Nothing in
// the app writes the subscription onto the company doc at that point:
// stripeWebhook.js does, but it's a separate, asynchronous delivery from
// Stripe's side that routinely lands AFTER the browser has already
// redirected back and re-read the company doc. The page a subscriber lands
// on therefore showed the same "Subscribe" card they just paid on, with
// nothing about their subscription updated - and, if the webhook endpoint
// isn't reachable or isn't registered in the Stripe Dashboard at all, it
// stayed that way permanently.
//
// This callable closes that gap from the client's side: BillingPage.jsx
// calls it on return from Checkout, and it applies exactly the same
// reconciliation the webhook would (applySubscriptionState +
// syncSelfServeTier, the shared pair - see applySubscriptionState.js), so
// whichever of the two paths runs first wins and the second is a harmless
// no-op rewrite of identical state. It never creates or modifies anything
// in Stripe: it reads the company's subscriptions and mirrors what's there,
// exactly like the webhook does.
//
// Company Admin only, same reasoning as every other billing callable in
// this directory - it writes billing state for the company.
exports.syncCheckoutSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { companyId } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'sync_checkout_session')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'sync_checkout_session',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may sync billing for this company')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  // No Stripe Customer means checkout was never started for this company -
  // there is nothing to reconcile, and nothing has gone wrong.
  const stripeCustomerId = company.stripeCustomerId
  if (!stripeCustomerId) {
    return { synced: false, reason: 'no_customer' }
  }

  const stripe = getStripeClient()
  const list = await stripe.subscriptions.list({ customer: stripeCustomerId, status: 'all', limit: 20 })
  const current = pickCurrentSubscription(list.data ?? [])
  if (!current) {
    // Stripe hasn't finished creating the subscription yet (the client
    // retries), or the customer abandoned checkout. Either way this is a
    // "not yet", not an error - the caller decides whether to try again.
    return { synced: false, reason: 'no_subscription' }
  }

  // Re-fetched with the product expansion applySubscriptionState() requires
  // to tell the Core item from the Pulse Check item - the list call above
  // can't expand that deeply.
  const subscription = await stripe.subscriptions.retrieve(current.id, {
    expand: ['items.data.price.product'],
  })

  // A subscription created through createCheckoutSession.js already carries
  // this (subscription_data.metadata), but one created any other way for
  // this customer may not - and without it stripeWebhook.js silently skips
  // every future event about it (handleSubscriptionUpdated /
  // handleSubscriptionDeleted both key off metadata.companyId). Backfilling
  // it here is what keeps this callable a one-time catch-up rather than the
  // permanent sync path.
  if (subscription.metadata?.companyId !== companyId) {
    try {
      await stripe.subscriptions.update(subscription.id, { metadata: { ...subscription.metadata, companyId } })
    } catch (err) {
      // Best-effort: the Firestore-side reconciliation below is the point of
      // this call and must still happen.
      logger.warn('syncCheckoutSession: could not backfill companyId metadata', {
        companyId,
        subscriptionId: subscription.id,
        error: err.message,
      })
    }
  }

  await applySubscriptionState(firestore, companyId, subscription)
  await syncSelfServeTier(firestore, companyId, subscription)

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'sync_checkout_session',
    outcome: 'granted',
    detail: subscription.status,
  })

  return { synced: true, billingStatus: subscription.status }
})
