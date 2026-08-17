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
//
// See readDeclaredEmployeeCount() below for which employee-count field is
// authoritative for all of this - it is not the live Pulse Check roster.
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

// Server-side copy of src/config/pricingConfig.js's PULSE_CHECK_BANDS - the
// published Pulse Check add-on price for headcount at or below
// PROGRESSIVE_THRESHOLD_EMPLOYEES. This IS what calculatePulseCheckAddOnPrice()
// below bills through (createCheckoutSession.js, togglePulseCheckAddOn.js,
// syncSubscriptionPricing.js, calculateQuote.js) - there is no other,
// flat-per-employee pricing track for Pulse Check.
const PULSE_CHECK_BANDS = [
  { tier: 'starter', label: 'Starter', minEmployees: 1, maxEmployees: 25, monthlyPrice: 10 },
  { tier: 'growth', label: 'Growth', minEmployees: 26, maxEmployees: 100, monthlyPrice: 29 },
  { tier: 'scale', label: 'Scale', minEmployees: 101, maxEmployees: 300, monthlyPrice: 69 },
  { tier: 'business', label: 'Business', minEmployees: 301, maxEmployees: 500, monthlyPrice: 129 },
]

// Pulse Check's progressive formula for headcount above the published-band
// cap, mirroring PROGRESSIVE_PRICING's tax-bracket shape with Pulse Check's
// own base fee and rates.
//
// RATE_TBD: the 2,501-5,000 rate has not been published or confirmed
// anywhere - it is set equal to the 1,001-2,500 rate as a placeholder so the
// formula stays monotonic instead of guessing a number. Must be confirmed
// and replaced before billing any company in this headcount range.
const PULSE_CHECK_PROGRESSIVE_PRICING = {
  baseFee: 50,
  brackets: [
    { label: 'First 1,000', uptoEmployees: 1000, ratePerEmployee: 0.2 },
    { label: 'Next 1,500 (1,001-2,500)', uptoEmployees: 2500, ratePerEmployee: 0.15 },
    { label: 'Next 2,500 (2,501-5,000) - RATE_TBD', uptoEmployees: 5000, ratePerEmployee: 0.15 },
    { label: 'Above 5,000', uptoEmployees: Infinity, ratePerEmployee: 0.1 },
  ],
}

function pulseCheckBandForEmployeeCount(employeeCount) {
  return PULSE_CHECK_BANDS.find((band) => employeeCount >= band.minEmployees && employeeCount <= band.maxEmployees) ?? null
}

// AUTHORITATIVE EMPLOYEE COUNT, DECIDED: companies/{companyId}.employeeCount
// (self-declared by the Company Admin, written by upgradeSubscription.js /
// PackageSelector.jsx) is the one number every billing path in this
// directory reads - calculateQuote.js, createCheckoutSession.js,
// togglePulseCheckAddOn.js, syncSubscriptionPricing.js, and
// upgradeSubscription.js all call this function, not the live Pulse Check
// roster. The roster-derived count this module used to compute
// (countActiveEmployees(), removed) is gone from every billing call site -
// nothing here bills off the real Pulse Check roster size. Pilot v1 has no
// automated reconciliation between the declared number and the roster; a
// Company Admin under-declaring headcount under-bills their own company, and
// that is an accepted v1 risk, not a bug to route around by silently falling
// back to the roster count in one code path and not another.
function readDeclaredEmployeeCount(company) {
  const count = Number(company?.employeeCount)
  return Number.isFinite(count) && Number.isInteger(count) && count >= 1 ? count : null
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

function calculatePulseCheckProgressivePrice(employeeCount) {
  let remaining = employeeCount
  let previousCeiling = 0
  let total = PULSE_CHECK_PROGRESSIVE_PRICING.baseFee

  for (const bracket of PULSE_CHECK_PROGRESSIVE_PRICING.brackets) {
    if (remaining <= 0) break

    const sliceSize = Math.min(remaining, bracket.uptoEmployees - previousCeiling)
    if (sliceSize > 0) {
      total += sliceSize * bracket.ratePerEmployee
      remaining -= sliceSize
    }

    previousCeiling = bracket.uptoEmployees
  }

  return roundToCents(total)
}

// Published-band lookup at or below PROGRESSIVE_THRESHOLD_EMPLOYEES (the
// $10/$29/$69/$129 bands), the progressive formula above it. This replaces
// the old flat employeeCount * ratePerEmployeePerMonth calculation - Pulse
// Check has never actually been priced per-employee at this scale, only in
// published bands.
function calculatePulseCheckAddOnPrice(employeeCount) {
  if (employeeCount <= PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    const band = pulseCheckBandForEmployeeCount(employeeCount)
    return band.monthlyPrice
  }
  return calculatePulseCheckProgressivePrice(employeeCount)
}

module.exports = {
  PROGRESSIVE_THRESHOLD_EMPLOYEES,
  PUBLISHED_BANDS,
  PULSE_CHECK_BANDS,
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  bandForEmployeeCount,
  pulseCheckBandForEmployeeCount,
  calculateMonthlyPrice,
  calculatePulseCheckAddOnPrice,
  readDeclaredEmployeeCount,
}
