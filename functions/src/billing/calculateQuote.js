const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// Server-side copy of src/config/pricingConfig.js's constants. This file is
// the ONLY place a quote may legitimately be computed for billing: functions
// and the app are separate deployables (this is CommonJS, the app is an ES
// module bundle - see functions/package.json vs. package.json), so this
// module cannot import the client config across that boundary and instead
// carries its own copy. The client-side calculator
// (src/utils/pricingCalculator.js) mirrors these same numbers for instant UI
// feedback only; ITS output must never be persisted as a billed amount.
// Whenever a rate, band boundary, or base fee changes, update it here AND in
// src/config/pricingConfig.js, or the price a company sees will drift from
// what this function would actually quote.
const PROGRESSIVE_THRESHOLD_EMPLOYEES = 500

const PUBLISHED_BANDS = [
  { tier: 'starter', label: 'Starter', minEmployees: 1, maxEmployees: 25, monthlyPrice: 59 },
  { tier: 'growth', label: 'Growth', minEmployees: 26, maxEmployees: 200, monthlyPrice: 199 },
  { tier: 'scale', label: 'Scale', minEmployees: 201, maxEmployees: 500, monthlyPrice: 549 },
]

const PROGRESSIVE_PRICING = {
  tier: 'enterprise',
  label: 'Enterprise',
  baseFee: 250,
  brackets: [
    { label: 'First 1,000', uptoEmployees: 1000, ratePerEmployee: 1.1 },
    { label: 'Next 1,500 (1,001-2,500)', uptoEmployees: 2500, ratePerEmployee: 0.85 },
    { label: 'Next 2,500 (2,501-5,000)', uptoEmployees: 5000, ratePerEmployee: 0.65 },
    { label: 'Above 5,000', uptoEmployees: Infinity, ratePerEmployee: 0.5 },
  ],
}

const MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES = 5000

const PULSE_CHECK_ADD_ON = {
  ratePerEmployeePerMonth: 1,
}

function roundToCents(amount) {
  return Math.round(amount * 100) / 100
}

function bandForEmployeeCount(employeeCount) {
  return PUBLISHED_BANDS.find(
    (band) => employeeCount >= band.minEmployees && employeeCount <= band.maxEmployees
  )
}

function calculateFlatBandPrice(employeeCount) {
  const band = bandForEmployeeCount(employeeCount)
  return {
    tier: band.tier,
    monthlyPrice: band.monthlyPrice,
    effectiveRatePerEmployee: roundToCents(band.monthlyPrice / employeeCount),
    needsManualReview: false,
    breakdown: [
      { label: band.label, employees: employeeCount, ratePerEmployee: null, amount: band.monthlyPrice },
    ],
  }
}

function calculateProgressivePrice(employeeCount) {
  const breakdown = [
    { label: 'Base fee', employees: null, ratePerEmployee: null, amount: PROGRESSIVE_PRICING.baseFee },
  ]

  let remaining = employeeCount
  let previousCeiling = 0
  let total = PROGRESSIVE_PRICING.baseFee

  for (const bracket of PROGRESSIVE_PRICING.brackets) {
    if (remaining <= 0) break

    const sliceSize = Math.min(remaining, bracket.uptoEmployees - previousCeiling)
    if (sliceSize > 0) {
      const amount = roundToCents(sliceSize * bracket.ratePerEmployee)
      breakdown.push({ label: bracket.label, employees: sliceSize, ratePerEmployee: bracket.ratePerEmployee, amount })
      total += amount
      remaining -= sliceSize
    }

    previousCeiling = bracket.uptoEmployees
  }

  total = roundToCents(total)

  return {
    tier: PROGRESSIVE_PRICING.tier,
    monthlyPrice: total,
    effectiveRatePerEmployee: roundToCents(total / employeeCount),
    needsManualReview: employeeCount > MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
    breakdown,
  }
}

// Same tax-bracket-style formula as pricingCalculator.js's
// calculateMonthlyPrice(), reproduced here because this is the copy whose
// output is authoritative. Case volume never enters this calculation - price
// is a function of headcount only.
function calculateMonthlyPrice(employeeCount) {
  if (!Number.isFinite(employeeCount) || employeeCount < 1 || !Number.isInteger(employeeCount)) {
    throw new HttpsError('invalid-argument', 'employeeCount must be a positive integer')
  }

  return employeeCount <= PROGRESSIVE_THRESHOLD_EMPLOYEES
    ? calculateFlatBandPrice(employeeCount)
    : calculateProgressivePrice(employeeCount)
}

function calculatePulseCheckAddOnPrice(employeeCount) {
  return roundToCents(employeeCount * PULSE_CHECK_ADD_ON.ratePerEmployeePerMonth)
}

// Counts the company's real, billable headcount: everyone on the Pulse Check
// roster (companies/{companyId}/employees) who isn't marked inactive. Same
// filter SettingsPage.jsx's roster-size display and
// functions/src/intake/schedulePulseChecks.js's send loop both use, so the
// number a quote is based on matches the number a Pulse Check send would
// actually reach.
async function countActiveEmployees(firestore, companyId) {
  const snapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(EMPLOYEES_SUBCOLLECTION)
    .select('status')
    .get()

  return snapshot.docs.filter((doc) => doc.data().status !== 'inactive').length
}

// Company Admin's billing quote, computed server-side from the company's
// real roster so the number this returns always matches what would be
// invoiced - the client-side pricingCalculator.js copy is for instant what-if
// UI feedback only and is never the source of truth for an actual bill.
// Company Admin only, and only for their own company: companyId in the
// request is verified against the caller's own custom claim rather than
// trusted outright, the same pattern functions/src/retention/previewRetention.js
// uses.
//
// This does not implement payment processing, invoicing, or any
// Stripe/payment-provider integration - it returns a price number and a
// breakdown for display only.
exports.calculateQuote = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only view billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'calculate_quote')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'calculate_quote',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may view billing for this company')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'calculate_quote', outcome: 'granted' })

  const employeeCount = await countActiveEmployees(firestore, companyId)
  if (employeeCount < 1) {
    return {
      employeeCount: 0,
      quote: null,
      pulseCheckAddOnPrice: 0,
    }
  }

  const quote = calculateMonthlyPrice(employeeCount)

  return {
    employeeCount,
    quote,
    pulseCheckAddOnPrice: calculatePulseCheckAddOnPrice(employeeCount),
  }
})
