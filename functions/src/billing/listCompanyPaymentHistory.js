const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const SUPER_ADMINS_COLLECTION = 'superAdmins'
const INVOICE_LIST_LIMIT = 12

// Same allowlist check as linkCompanySubscription.js's requireSuperAdmin -
// Super Admin is membership at superAdmins/{uid}, not a custom claim.
async function requireSuperAdmin(actorUid) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Super Admin to view company payment history')
  }
  const snapshot = await admin.firestore().collection(SUPER_ADMINS_COLLECTION).doc(actorUid).get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can view this company\'s payment history')
  }
}

// Super Admin billing panel's invoice list - the most recent
// INVOICE_LIST_LIMIT invoices for a company's Stripe Customer, fetched live
// on every call (never cached in Firestore, same convention as
// getCompanyBillingSummary.js). Returns only a narrow, pre-picked shape per
// invoice - never the raw Stripe Invoice object - so nothing beyond what the
// panel actually renders (amount, status, date, a link to Stripe's own
// hosted invoice page, and the invoice number) ever reaches the client.
//
// A company with no stripeCustomerId yet returns an empty list instead of
// throwing, so the panel can render a "no invoices" empty state rather than
// treating a brand-new company as an error.
exports.listCompanyPaymentHistory = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = request.auth?.uid
  await requireSuperAdmin(uid)

  const { companyId } = request.data || {}
  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }

  const firestore = admin.firestore()
  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const stripeCustomerId = companySnapshot.data()?.stripeCustomerId

  if (!stripeCustomerId) {
    return { invoices: [] }
  }

  const stripe = getStripeClient()
  const invoiceList = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit: INVOICE_LIST_LIMIT,
  })

  const invoices = (invoiceList.data ?? []).map((invoice) => ({
    id: invoice.id,
    amountPaidCents: invoice.amount_paid,
    currency: invoice.currency,
    status: invoice.status,
    created: invoice.created,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    number: invoice.number ?? null,
  }))

  return { invoices }
})
