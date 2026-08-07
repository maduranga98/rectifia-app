// Single source of truth for Rectifia's billing amounts. Every rate, band
// boundary, and base fee lives here as a named constant so a price change is
// a one-file edit: nothing outside this file (src/utils/pricingCalculator.js,
// functions/src/billing/calculateQuote.js, BillingQuote.jsx) may hardcode a
// pricing number of its own.
//
// functions/src/billing/calculateQuote.js is a separate deployable (its own
// CommonJS package - see functions/package.json) and cannot import this ES
// module at deploy time, so it carries its own copy of these same constants
// rather than reaching across the deploy boundary. If a number below changes,
// the matching constant in calculateQuote.js must change with it, or the
// server-side (billed) price and this client-side (preview) price will
// disagree - see the comment at the top of that file for the full rationale.

// At or below this headcount, price is a flat lookup in PUBLISHED_BANDS.
// Above it, price is the progressive marginal-rate formula in
// PROGRESSIVE_PRICING, applied to the full headcount from employee 1 (not
// just the portion above the threshold).
export const PROGRESSIVE_THRESHOLD_EMPLOYEES = 500

// Flat, published monthly price per band - no calculation, just a lookup.
export const PUBLISHED_BANDS = [
  { tier: 'starter', label: 'Starter', minEmployees: 1, maxEmployees: 25, monthlyPrice: 59 },
  { tier: 'growth', label: 'Growth', minEmployees: 26, maxEmployees: 200, monthlyPrice: 199 },
  { tier: 'scale', label: 'Scale', minEmployees: 201, maxEmployees: 500, monthlyPrice: 549 },
]

// Tax-bracket-style marginal pricing for 500+ employees: each slice of
// headcount is charged at its own rate, not the whole headcount at one rate.
// `uptoEmployees` is the cumulative headcount ceiling of the slice (Infinity
// for the last, open-ended slice).
export const PROGRESSIVE_PRICING = {
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

// Above this headcount, quotes are flagged for manual sales review rather
// than fully automated - the progressive formula still computes a number
// (contracts and the admin UI need one to show), but it must never be
// presented as a final, automatically-issued price at this scale.
export const MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES = 5000

// Pulse Check add-on: always per-employee, always flat, never bracketed.
// Priced and billed completely separately from the core monthly price above -
// see calculateMonthlyPrice()'s doc comment in pricingCalculator.js for why
// the two must never be merged into one function.
export const PULSE_CHECK_ADD_ON = {
  ratePerEmployeePerMonth: 1,
}
