const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { calculatePulseCheckAddOnPrice, readDeclaredEmployeeCount } = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { pulseCheckPriceData } = require('./createCheckoutSession')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Adds or removes the Pulse Check add-on subscription item on a company's
// EXISTING Stripe subscription - never a new Checkout Session, since a
// payment method is already on file once createCheckoutSession.js has run
// once. This is the paid side of src/config/featureFlags.js's pulseCheck
// flag: turning the add-on on here also flips that flag on, so the module
// unlocks the moment the purchase succeeds, and turning it off here flips
// the flag off, so access ends the moment the add-on is cancelled. A Super
// Admin's manual override in FeatureFlagPanel.jsx still exists and still
// wins on top of this (see resolveFeatureFlag) - this callable only ever
// writes the same explicit-override field that panel writes, for the
// company's own paid/unpaid state rather than a one-off grant.
//
// Company Admin only, same reasoning as createBillingCheckoutSession.js:
// this spends (or stops spending) the company's money, which is stricter
// than the view-only billingView permission module.
exports.togglePulseCheckAddOn = onCall({ secrets: [stripeSecretKey] }, async (request) => {
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
  const role = await loadCallerRole(firestore, companyId, uid, 'toggle_pulse_check_add_on')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'toggle_pulse_check_add_on',
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

  const stripe = getStripeClient()

  if (enable) {
    if (company.stripePulseCheckItemId) {
      // Already on - idempotent no-op rather than an error, so a client
      // retry after a dropped response never double-adds the item.
      return { pulseCheckEnabled: true }
    }

    const employeeCount = readDeclaredEmployeeCount(company)
    if (employeeCount === null) {
      throw new HttpsError('failed-precondition', 'Declare your company\'s employee count before adding Pulse Check')
    }

    // Default proration_behavior ('create_prorations') is intentional here:
    // adding a paid module mid-cycle should charge a prorated amount for the
    // rest of the current period, the same way most subscription add-ons
    // work, rather than being free until the next renewal.
    const item = await stripe.subscriptionItems.create({
      subscription: company.stripeSubscriptionId,
      price_data: pulseCheckPriceData(calculatePulseCheckAddOnPrice(employeeCount)),
      quantity: 1,
    })

    await companyRef.update({
      stripePulseCheckItemId: item.id,
      'featureFlags.pulseCheck': true,
    })
  } else {
    if (!company.stripePulseCheckItemId) {
      return { pulseCheckEnabled: false }
    }

    // clear_usage isn't relevant (this is a licensed, not metered, item);
    // Stripe prorates the cancellation credit by default, same reasoning as
    // the create above.
    await stripe.subscriptionItems.del(company.stripePulseCheckItemId)

    await companyRef.update({
      stripePulseCheckItemId: admin.firestore.FieldValue.delete(),
      'featureFlags.pulseCheck': false,
    })
  }

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'toggle_pulse_check_add_on',
    outcome: 'granted',
    detail: enable ? 'enabled' : 'disabled',
  })

  return { pulseCheckEnabled: enable }
})
