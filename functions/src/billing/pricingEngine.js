const { HttpsError } = require('firebase-functions/v2/https')

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
//
// Every function in functions/src/billing/ that needs a price - the read-only
// quote (calculateQuote.js), Checkout session creation, and the recurring
// Stripe price resync - shares this one module rather than each carrying its
// own copy, so there is exactly one server-side formula, not three.
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

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'

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

module.exports = {
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  calculateMonthlyPrice,
  calculatePulseCheckAddOnPrice,
  countActiveEmployees,
}
