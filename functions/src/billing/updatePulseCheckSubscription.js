const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { PROGRESSIVE_THRESHOLD_EMPLOYEES, pulseCheckBandForEmployeeCount } = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { applySubscriptionState } = require('./applySubscriptionState')
const { LINE_ITEM_TAG } = require('./lineItemTags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Adds or removes the Pulse Check add-on item on a company's EXISTING Stripe
// subscription - never a new Checkout Session, since a payment method is
// already on file once createCheckoutSession.js has run once. Mirrors the
// deleted togglePulseCheckAddOn.js's logic, with two differences: price is
// computed from the REAL roster headcount (a count() aggregation against
// companies/{companyId}/employees), not the self-declared
// company.employeeCount, and only callable at or below the 500-employee
// self-serve ceiling - above it, a Pulse Check change goes through
// requestQuote.js like everything else at that scale.
//
// Company Admin only, same reasoning as createCheckoutSession.js.
exports.updatePulseCheckSubscription = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, enable } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  if (typeof enable !== 'boolean') {
    throw new HttpsError('invalid-argument', 'enable must be true or false')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'update_pulse_check_subscription')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'update_pulse_check_subscription',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may change the Pulse Check add-on')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  if (!company.stripeSubscriptionId) {
    throw new HttpsError('failed-precondition', 'Set up billing before adding Pulse Check')
  }

  const countSnapshot = await companyRef.collection(EMPLOYEES_SUBCOLLECTION).count().get()
  const employeeCount = countSnapshot.data().count

  if (employeeCount > PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    throw new HttpsError(
      'failed-precondition',
      `Self-serve Pulse Check changes aren't available above ${PROGRESSIVE_THRESHOLD_EMPLOYEES} employees - request a quote instead.`
    )
  }

  const stripe = getStripeClient()

  if (enable) {
    if (!company.stripePulseCheckItemId) {
      if (employeeCount < 1) {
        throw new HttpsError('failed-precondition', 'Add employees to your roster before adding Pulse Check')
      }
      const band = pulseCheckBandForEmployeeCount(employeeCount)
      // Default proration_behavior ('create_prorations') is intentional -
      // adding a paid add-on mid-cycle should charge a prorated amount for
      // the rest of the current period, the same way the deleted
      // togglePulseCheckAddOn.js's own create call worked.
      await stripe.subscriptionItems.create({
        subscription: company.stripeSubscriptionId,
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Rectifia - Pulse Check add-on',
            metadata: { rectifiaLineItem: LINE_ITEM_TAG.PULSE_CHECK },
          },
          unit_amount: Math.round(band.monthlyPrice * 100),
          recurring: { interval: 'month' },
        },
        quantity: 1,
      })
    }
    // Already on - idempotent no-op, so a client retry after a dropped
    // response never double-adds the item.
  } else if (company.stripePulseCheckItemId) {
    // clear_usage isn't relevant (this is a licensed, not metered, item);
    // Stripe prorates the cancellation credit by default.
    await stripe.subscriptionItems.del(company.stripePulseCheckItemId)
  }

  // Re-fetches and reconciles from the live subscription rather than
  // hand-writing stripePulseCheckItemId/featureFlags.pulseCheck here -
  // applySubscriptionState() is the one place that logic lives, shared with
  // stripeWebhook.js and linkCompanySubscription.js.
  const subscription = await stripe.subscriptions.retrieve(company.stripeSubscriptionId, {
    expand: ['items.data.price.product'],
  })
  await applySubscriptionState(firestore, companyId, subscription)

  // Company-facing (companyAdmin role) - enable flag only. Best-effort: a
  // failure here must never fail the toggle itself, which has already
  // succeeded above.
  try {
    await firestore.collection(NOTIFICATIONS_COLLECTION).add({
      type: 'pulseCheckToggled',
      companyId,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      enable,
    })
  } catch (err) {
    logger.error('updatePulseCheckSubscription: failed to write pulseCheckToggled notification', {
      companyId,
      error: err.message,
    })
  }

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'update_pulse_check_subscription',
    outcome: 'granted',
    detail: enable ? 'enabled' : 'disabled',
  })

  return { pulseCheckEnabled: enable }
})
