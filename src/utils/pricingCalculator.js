// Pure pricing math for instant UI feedback (current-price display, the
// what-if headcount calculator). No side effects, no network calls, nothing
// persisted from here.
//
// THIS IS NOT WHERE A BILL COMES FROM. This module must never be wired up as
// the thing that determines what a company is actually charged - it exists so
// the UI can show a number the instant an admin types a headcount, without a
// round trip. The only calculation whose output may ever be persisted as a
// billed amount is the Cloud Function in
// functions/src/billing/calculateQuote.js, which recomputes the price
// server-side from the company's real roster. Treat any number this module
// returns as a preview, never as an invoice.
import {
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  PROGRESSIVE_PRICING,
  PROGRESSIVE_THRESHOLD_EMPLOYEES,
  PUBLISHED_BANDS,
  PULSE_CHECK_PROGRESSIVE_PRICING,
  pulseCheckBandForEmployeeCount,
} from '../config/pricingConfig'

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
  if (!band) {
    throw new Error(`No published band covers ${employeeCount} employees`)
  }

  return {
    tier: band.tier,
    monthlyPrice: band.monthlyPrice,
    effectiveRatePerEmployee: roundToCents(band.monthlyPrice / employeeCount),
    needsManualReview: false,
    breakdown: [
      {
        label: band.label,
        employees: employeeCount,
        ratePerEmployee: null,
        amount: band.monthlyPrice,
      },
    ],
  }
}

function calculateProgressivePrice(employeeCount) {
  const scalePrice = PUBLISHED_BANDS.find((band) => band.tier === 'scale').monthlyPrice
  const breakdown = [
    { label: 'Scale (first 500)', employees: PROGRESSIVE_THRESHOLD_EMPLOYEES, amount: scalePrice },
  ]

  let remaining = employeeCount - PROGRESSIVE_THRESHOLD_EMPLOYEES
  let previousCeiling = PROGRESSIVE_THRESHOLD_EMPLOYEES
  let total = scalePrice

  for (const bracket of PROGRESSIVE_PRICING.brackets) {
    if (remaining <= 0) break

    const sliceSize = Math.min(remaining, bracket.uptoEmployees - previousCeiling)
    if (sliceSize > 0) {
      const amount = roundToCents(sliceSize * bracket.ratePerEmployee)
      breakdown.push({
        label: bracket.label,
        employees: sliceSize,
        ratePerEmployee: bracket.ratePerEmployee,
        amount,
      })
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

// Returns { tier, monthlyPrice, effectiveRatePerEmployee, needsManualReview,
// breakdown }. `breakdown` is an ordered list of every bracket's (or the flat
// band's) contribution, for transparency in the admin UI and in generated
// contracts. Case volume never enters this calculation - price is a function
// of headcount only.
export function calculateMonthlyPrice(employeeCount) {
  const count = Number(employeeCount)
  if (!Number.isFinite(count) || count < 1 || !Number.isInteger(count)) {
    throw new Error('employeeCount must be a positive integer')
  }

  return count <= PROGRESSIVE_THRESHOLD_EMPLOYEES
    ? calculateFlatBandPrice(count)
    : calculateProgressivePrice(count)
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

// Pulse Check add-on price. Deliberately a separate function from
// calculateMonthlyPrice(): it has its own published bands and its own
// progressive formula above the self-serve threshold, not Core's - merging
// it into the core pricing function would let a future edit accidentally
// apply Core's bracket math to it.
export function calculatePulseCheckAddOnPrice(employeeCount) {
  const count = Number(employeeCount)
  if (!Number.isFinite(count) || count < 0) {
    throw new Error('employeeCount must be a non-negative number')
  }

  if (count <= PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    const band = pulseCheckBandForEmployeeCount(count)
    if (!band) {
      throw new Error(`No published Pulse Check band covers ${count} employees`)
    }
    return band.monthlyPrice
  }

  return calculatePulseCheckProgressivePrice(count)
}
