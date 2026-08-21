const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { bandLikeForEmployeeCount, MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES } = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { changeCoreTier } = require('./changeCoreTier')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// The declared-count counterpart of upgradeSubscriptionTier.js: a company
// whose subscription is priced from a self-declared headcount
// (company.billingHeadcountSource === 'declared', set by
// createCheckoutSession.js at checkout time) never has a real roster to
// count against, so it never hits addEmployee.js's headcount-cap check and
// never reaches upgradeSubscriptionTier.js's cap-triggered upgrade prompt.
// This is the Company Admin's own way to re-declare that number and, if it
// now falls in a different PUBLISHED_BANDS tier, move the Core item to match
// - via the same changeCoreTier.js mechanics upgradeSubscriptionTier.js uses.
//
// Unlike upgradeSubscriptionTier.js, this can move the tier UP or DOWN: a
// roster-priced company's cap can only ever be reached by hiring (the roster
// only grows across addEmployee.js's own guard), but a declared headcount is
// just a number a Company Admin types in and can correct in either
// direction. Explicitly refuses to run at all for a roster-priced company
// (or one predating Module 29J with no billingHeadcountSource yet) - that
// company's tier can only ever move through the roster-cap flow above.
exports.updateDeclaredHeadcount = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, newCount, attested } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'update_declared_headcount')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'update_declared_headcount',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may update the declared headcount')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  if (company.billingHeadcountSource !== 'declared') {
    throw new HttpsError(
      'failed-precondition',
      "This company's subscription is priced from its real roster, not a declared count"
    )
  }
  if (!company.stripeSubscriptionId || !company.stripeCoreItemId) {
    throw new HttpsError('failed-precondition', 'Set up billing before updating headcount')
  }

  const count = Number(newCount)
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
    throw new HttpsError('invalid-argument', 'newCount must be a positive integer')
  }
  if (attested !== true) {
    throw new HttpsError('invalid-argument', 'You must attest that this headcount is accurate')
  }

  if (count > MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES) {
    throw new HttpsError(
      'failed-precondition',
      `Self-serve plan changes aren't available above ${MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES} employees - request a quote instead.`
    )
  }

  const band = bandLikeForEmployeeCount(count)
  const previousTier = company.subscriptionTier ?? null

  // Reconfirmed at the same tier - just record the new number and the
  // attestation, no Stripe call and no billingHistory entry (there is no
  // tier change to log).
  if (band.tier === previousTier) {
    await companyRef.update({
      employeeCount: count,
      headcountAttestedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'update_declared_headcount',
      outcome: 'granted',
      detail: `reconfirmed:${band.tier}`,
    })

    return { subscriptionTier: band.tier, previousTier, changed: false }
  }

  const stripe = getStripeClient()
  await changeCoreTier(firestore, stripe, companyRef, company, band, {
    action: 'declared_headcount_tier_change',
    changedByUid: uid,
    changedByRole: role,
    extra: { newCount: count },
  })

  await companyRef.update({
    employeeCount: count,
    headcountAttestedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'update_declared_headcount',
    outcome: 'granted',
    detail: `${previousTier ?? 'none'}->${band.tier}`,
  })

  return { subscriptionTier: band.tier, previousTier, changed: true, cap: band.maxEmployees }
})
