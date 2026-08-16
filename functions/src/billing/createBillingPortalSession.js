const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { stripeSecretKey, appBaseUrl, getStripeClient } = require('./stripeClient')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Returns a Stripe-hosted Billing Portal URL for a company that already has
// a Stripe customer: update payment method, view invoices, or cancel. No
// portal configuration is created here - the Stripe Dashboard's default
// portal configuration is what a fresh Stripe account starts with, and must
// be reviewed/customized in the Stripe Dashboard (which self-serve actions
// to allow, e.g. whether cancellation is self-serve) before relying on this
// in production.
//
// Company Admin only, same reasoning as the other billing callables in this
// directory - the portal can cancel or change payment on file, not merely
// view.
exports.createBillingPortalSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
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
  const role = await loadCallerRole(firestore, companyId, uid, 'create_billing_portal_session')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'create_billing_portal_session',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may manage billing for this company')
  }

  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  const stripeCustomerId = companySnapshot.data()?.stripeCustomerId
  if (!stripeCustomerId) {
    throw new HttpsError('failed-precondition', 'Set up billing before opening the billing portal')
  }

  const stripe = getStripeClient()
  const base = appBaseUrl.value().replace(/\/+$/, '')
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${base}/admin/billing`,
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'create_billing_portal_session',
    outcome: 'granted',
  })

  return { url: session.url }
})
