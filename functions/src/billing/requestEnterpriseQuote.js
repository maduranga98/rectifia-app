const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  PROGRESSIVE_THRESHOLD_EMPLOYEES,
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  calculateMonthlyPrice,
  calculatePulseCheckAddOnPrice,
} = require('./pricingEngine')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const QUOTE_REQUESTS_COLLECTION = 'quoteRequests'

// The "Contact sales" path for a company above the 500-employee self-serve
// threshold (see upgradeSubscription.js, which refuses self-serve band
// selection above that same threshold). This callable computes the real
// progressive-formula quote using this module's own copy of Module 29's
// pricing engine (functions/src/billing/pricingEngine.js - the same
// calculateMonthlyPrice() calculateQuote.js uses for its own read-only
// quote) and writes it to quoteRequests/{companyId} for Lumora's internal
// sales follow-up. The formula, the brackets, and the per-employee rates
// that produced the number NEVER appear in this callable's return value -
// only a bare confirmation that the request was recorded. A customer-facing
// quote calculator that reveals marginal per-employee rates at this scale is
// exactly what the published-band pricing model above 500 employees is
// designed not to expose.
exports.requestEnterpriseQuote = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, target } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only request billing for your own company')
  }
  if (target !== 'core' && target !== 'pulseCheck') {
    throw new HttpsError('invalid-argument', "target must be 'core' or 'pulseCheck'")
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'request_enterprise_quote')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'request_enterprise_quote',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may request an enterprise quote')
  }

  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()

  const employeeCount = Number(company.employeeCount)
  if (!Number.isFinite(employeeCount) || !Number.isInteger(employeeCount) || employeeCount < 1) {
    throw new HttpsError(
      'failed-precondition',
      'Declare your company\'s employee count before requesting a quote'
    )
  }
  if (employeeCount <= PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    throw new HttpsError(
      'failed-precondition',
      'Self-serve plan selection is available at this headcount - a sales quote is not needed'
    )
  }

  // calculateMonthlyPrice() is Core's progressive-bracket formula. Pulse
  // Check above the self-serve bands has no separate bracket formula of its
  // own - it continues the same flat per-employee rate
  // calculatePulseCheckAddOnPrice() already applies at any headcount -
  // reshaped into the same { tier, monthlyPrice, breakdown } quote shape so
  // both targets store and log identically.
  const quote =
    target === 'core'
      ? calculateMonthlyPrice(employeeCount)
      : {
          tier: 'enterprise',
          monthlyPrice: calculatePulseCheckAddOnPrice(employeeCount),
          effectiveRatePerEmployee: null,
          needsManualReview: employeeCount > MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
          breakdown: [{ label: 'Pulse Check', employees: employeeCount, ratePerEmployee: null, amount: calculatePulseCheckAddOnPrice(employeeCount) }],
        }

  await firestore
    .collection(QUOTE_REQUESTS_COLLECTION)
    .doc(companyId)
    .set(
      {
        companyId,
        companyName: company.name ?? null,
        [`requests.${target}`]: {
          employeeCountAtRequest: employeeCount,
          quote,
          requestedByUid: uid,
          requestedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
        },
      },
      { merge: true }
    )

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'request_enterprise_quote',
    outcome: 'granted',
    detail: target,
  })

  // Deliberately bare - no monthlyPrice, no breakdown, no rate. The quote
  // just written above is for Lumora's own sales follow-up only.
  return { requested: true, target }
})
