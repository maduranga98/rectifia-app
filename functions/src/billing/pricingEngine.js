const { HttpsError } = require('firebase-functions/v2/https')

// Server-side copy of src/config/pricingConfig.js's constants. This file is
// the ONLY place a REFERENCE quote may legitimately be computed: functions
// and the app are separate deployables (this is CommonJS, the app is an ES
// module bundle - see functions/package.json vs. package.json), so this
// module cannot import the client config across that boundary and instead
// carries its own copy. The client-side calculator
// (src/utils/pricingCalculator.js) mirrors these same numbers for instant UI
// feedback only; ITS output must never be shown as anything but a preview
// either. Whenever a rate, band boundary, or base fee changes, update it
// here AND in src/config/pricingConfig.js, or the reference price a company
// sees will drift from what this function actually computes.
//
// Pilot v1 has no self-serve subscription path at all: every real
// customer's actual price is negotiated by hand and set up directly against
// Stripe by a human (see stripeWebhook.js's file comment), never computed
// here. What this module's formula drives is calculateQuote.js's read-only
// reference display and requestQuote.js's "Contact sales" request - the
// published-rate number a prospective customer sees is a starting point for
// a conversation, not an invoice.
//
// See resolveEffectiveEmployeeCount() below for which employee-count field is
// authoritative for this reference calculation: the real Pulse Check roster
// whenever a company has one, the self-declared estimate only as a fallback
// for a company with no roster yet.
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
// published Pulse Check add-on reference price for headcount at or below
// PROGRESSIVE_THRESHOLD_EMPLOYEES, shown by calculateQuote.js and quoted by
// requestQuote.js. There is no other, flat-per-employee pricing track for
// Pulse Check.
const PULSE_CHECK_BANDS = [
  { tier: 'starter', label: 'Starter', minEmployees: 1, maxEmployees: 25, monthlyPrice: 10 },
  { tier: 'growth', label: 'Growth', minEmployees: 26, maxEmployees: 100, monthlyPrice: 29 },
  { tier: 'scale', label: 'Scale', minEmployees: 101, maxEmployees: 300, monthlyPrice: 69 },
  { tier: 'business', label: 'Business', minEmployees: 301, maxEmployees: 500, monthlyPrice: 129 },
]

// Pulse Check's progressive formula for headcount above the published-band
// cap, mirroring PROGRESSIVE_PRICING's tax-bracket shape with Pulse Check's
// own base fee and rates. Every real customer at this scale is priced by a
// negotiated agreement, not this formula (see requestQuote.js) - this only
// has to be a reasonable, monotonically-decreasing reference number for a
// prospective pilot customer's "what would this roughly cost" quote.
//
// The 2,501-5,000 rate has never been separately published - it is set to
// the midpoint between the confirmed 1,001-2,500 rate (0.15) and the
// confirmed 5,000+ rate (0.1) rather than repeating the 1,001-2,500 rate
// verbatim, so the reference breakdown a prospective customer sees actually
// decreases bracket over bracket (as every other bracket here and in
// PROGRESSIVE_PRICING does) instead of showing a flat, un-marginal middle
// tier. Still an interpolated placeholder, not a published rate - confirm
// with sales before treating it as anything more than a reference number.
const PULSE_CHECK_PROGRESSIVE_PRICING = {
  baseFee: 50,
  brackets: [
    { label: 'First 1,000', uptoEmployees: 1000, ratePerEmployee: 0.2 },
    { label: 'Next 1,500 (1,001-2,500)', uptoEmployees: 2500, ratePerEmployee: 0.15 },
    { label: 'Next 2,500 (2,501-5,000)', uptoEmployees: 5000, ratePerEmployee: 0.125 },
    { label: 'Above 5,000', uptoEmployees: Infinity, ratePerEmployee: 0.1 },
  ],
}

function pulseCheckBandForEmployeeCount(employeeCount) {
  return PULSE_CHECK_BANDS.find((band) => employeeCount >= band.minEmployees && employeeCount <= band.maxEmployees) ?? null
}

// Self-declared employee count (companies/{companyId}.employeeCount, written
// by companyService.js's updateCompanyEmployeeCount) - the fallback estimate
// used only for a company with no real roster yet. See
// resolveEffectiveEmployeeCount() below, which every reference-pricing call
// site (calculateQuote.js, requestQuote.js) actually calls: it prefers the
// real Pulse Check roster (companies/{companyId}.currentEmployeeCount) over
// this declared number whenever the roster is non-empty.
function readDeclaredEmployeeCount(company) {
  const count = Number(company?.employeeCount)
  return Number.isFinite(count) && Number.isInteger(count) && count >= 1 ? count : null
}

// Single source of truth for which employee-count number a reference quote
// should be built from: the real Pulse Check roster
// (companies/{companyId}.currentEmployeeCount, maintained transactionally by
// addEmployee.js/removeEmployee.js/bulkAddEmployees.js) whenever a company
// has one, falling back to the self-declared estimate
// (readDeclaredEmployeeCount() above) only for a company with no roster yet.
// Returns which source was used so callers (calculateQuote.js,
// requestQuote.js, and ultimately BillingQuote.jsx) can label the number as
// an exact roster count or as a manual estimate rather than presenting an
// estimate as if it were exact.
function resolveEffectiveEmployeeCount(company) {
  const rosterCount = Number(company?.currentEmployeeCount)
  if (Number.isFinite(rosterCount) && Number.isInteger(rosterCount) && rosterCount >= 1) {
    return { count: rosterCount, source: 'roster' }
  }

  const declaredCount = readDeclaredEmployeeCount(company)
  if (declaredCount !== null) {
    return { count: declaredCount, source: 'declared' }
  }

  return { count: null, source: null }
}

function roundToCents(amount) {
  return Math.round(amount * 100) / 100
}

function bandForEmployeeCount(employeeCount) {
  return PUBLISHED_BANDS.find(
    (band) => employeeCount >= band.minEmployees && employeeCount <= band.maxEmployees
  )
}

// Uniform {tier, label, minEmployees, maxEmployees, monthlyPrice} shape
// spanning the full self-serve range (1-MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES),
// unlike bandForEmployeeCount() which only covers the flat PUBLISHED_BANDS
// range (up to PROGRESSIVE_THRESHOLD_EMPLOYEES). Above the flat bands it
// synthesizes an Enterprise pseudo-band from calculateProgressivePrice()'s
// output so self-serve callers (upgradeSubscriptionTier.js,
// updateDeclaredHeadcount.js) have one lookup that works across the whole
// self-serve ceiling instead of stopping at 500. Returns null above that
// ceiling - callers already guard that case separately.
function bandLikeForEmployeeCount(employeeCount) {
  const band = bandForEmployeeCount(employeeCount)
  if (band) return band
  if (employeeCount <= MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES) {
    const priced = calculateProgressivePrice(employeeCount)
    return {
      tier: priced.tier,
      label: 'Enterprise',
      minEmployees: PROGRESSIVE_THRESHOLD_EMPLOYEES + 1,
      maxEmployees: MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
      monthlyPrice: priced.monthlyPrice,
    }
  }
  return null
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

// Server-side copy of src/config/pricingConfig.js's PLAN_FEATURES map - the
// feature ladder driving which of featureFlags.js's FEATURE_FLAG_DEFAULTS
// keys a company's tier unlocks by default. Cloud Functions deploy
// separately from the web app and cannot import that ES module at deploy
// time (see this file's header comment for the same CommonJS/ES-module
// boundary), so this is an independent hand-kept copy, not a re-export -
// KEEP IT IN SYNC BY HAND with src/config/pricingConfig.js's PLAN_FEATURES.
const PLAN_FEATURES = {
  starter: [],
  growth: ['aiFollowUp', 'policyGrounding'],
  scale: ['aiFollowUp', 'policyGrounding', 'patternDetection', 'burnoutTrendDetection'],
  enterprise: [
    'aiFollowUp',
    'policyGrounding',
    'patternDetection',
    'burnoutTrendDetection',
    'benchmarkPool',
    'externalShareLinks',
  ],
}

// The six PLAN_FEATURES-ladder flags (deliberately excludes 'pulseCheck' -
// see PLAN_FEATURES' client-side comment) as an explicit true/false map for
// `tier`. An unknown or missing tier resolves every key to false rather than
// throwing, matching PLAN_FEATURES' own unknown-tier handling.
function featureFlagsForTier(tier) {
  const included = PLAN_FEATURES[tier] ?? []
  return {
    benchmarkPool: included.includes('benchmarkPool'),
    aiFollowUp: included.includes('aiFollowUp'),
    externalShareLinks: included.includes('externalShareLinks'),
    patternDetection: included.includes('patternDetection'),
    burnoutTrendDetection: included.includes('burnoutTrendDetection'),
    policyGrounding: included.includes('policyGrounding'),
  }
}

module.exports = {
  PROGRESSIVE_THRESHOLD_EMPLOYEES,
  PUBLISHED_BANDS,
  PULSE_CHECK_BANDS,
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  PLAN_FEATURES,
  bandForEmployeeCount,
  bandLikeForEmployeeCount,
  pulseCheckBandForEmployeeCount,
  calculateMonthlyPrice,
  calculatePulseCheckAddOnPrice,
  readDeclaredEmployeeCount,
  resolveEffectiveEmployeeCount,
  featureFlagsForTier,
}
