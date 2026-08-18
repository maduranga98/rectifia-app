const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { PROGRESSIVE_THRESHOLD_EMPLOYEES, bandForEmployeeCount } = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { changeCoreTier } = require('./changeCoreTier')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// Explicit, Company-Admin-initiated Core tier change - never triggered
// silently as a side effect of adding an employee. addEmployee.js /
// bulkAddEmployees.js only ever block with a headcount_cap_reached error;
// this is the separate action a Company Admin takes in response to that
// error (EmployeesPage.jsx's "Upgrade to Growth" prompt), never something
// that fires automatically on their behalf.
//
// Moves the Core subscription item to the PUBLISHED_BANDS tier that covers
// the roster's REAL current headcount plus one - the band that actually
// fits the employee the cap just blocked - rather than a tier the client
// names, so the target can't be manipulated from the client into a band the
// company's roster doesn't justify.
exports.upgradeSubscriptionTier = onCall({ secrets: [stripeSecretKey] }, async (request) => {
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
  const role = await loadCallerRole(firestore, companyId, uid, 'upgrade_subscription_tier')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'upgrade_subscription_tier',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may change the subscription plan')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  if (!company.stripeSubscriptionId || !company.stripeCoreItemId) {
    throw new HttpsError('failed-precondition', 'Set up billing before changing your plan')
  }

  const countSnapshot = await companyRef.collection(EMPLOYEES_SUBCOLLECTION).count().get()
  const employeeCount = countSnapshot.data().count

  if (employeeCount + 1 > PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    throw new HttpsError(
      'failed-precondition',
      `Self-serve plan changes aren't available above ${PROGRESSIVE_THRESHOLD_EMPLOYEES} employees - request a quote instead.`
    )
  }

  const band = bandForEmployeeCount(employeeCount + 1)
  const previousTier = company.subscriptionTier ?? null
  if (band.tier === previousTier) {
    throw new HttpsError('failed-precondition', `Your plan is already ${band.label} - no upgrade needed`)
  }

  const stripe = getStripeClient()
  // See changeCoreTier.js for the shared Stripe product-rename + price
  // update + applySubscriptionState + subscriptionTier write + billingHistory
  // log this delegates to - updateDeclaredHeadcount.js drives the exact same
  // mechanics for a declared-count company.
  await changeCoreTier(firestore, stripe, companyRef, company, band, {
    action: 'core_tier_upgrade',
    changedByUid: uid,
    changedByRole: role,
    extra: { employeeCountAtChange: employeeCount },
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'upgrade_subscription_tier',
    outcome: 'granted',
    detail: `${previousTier ?? 'none'}->${band.tier}`,
  })

  return { subscriptionTier: band.tier, cap: band.maxEmployees }
})
