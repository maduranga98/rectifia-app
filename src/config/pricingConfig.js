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
//
// This is the rate Stripe actually meters (createCheckoutSession.js,
// togglePulseCheckAddOn.js, syncSubscriptionPricing.js) and stays untouched
// by PULSE_CHECK_BANDS below - the two are separate pricing tracks for
// separate purposes, see that constant's comment.
export const PULSE_CHECK_ADD_ON = {
  ratePerEmployeePerMonth: 1,
}

// Pulse Check's own self-serve band pricing, for the Company Admin package-
// selection UI (PackageSelector.jsx/PulseCheckToggle.jsx,
// functions/src/billing/upgradeSubscription.js). This is a declared
// entitlement tier a Company Admin selects against their self-reported
// employeeCount - stored as companies/{companyId}.pulseCheckTier - and is
// deliberately independent of PULSE_CHECK_ADD_ON's flat per-employee rate
// above, which is what the existing Stripe subscription item actually
// charges. Four bands, not three, and capped at 500 employees like Core's
// PROGRESSIVE_THRESHOLD_EMPLOYEES - above that, Pulse Check follows the same
// contact-sales path as Core rather than a published band price.
export const PULSE_CHECK_BANDS = [
  { tier: 'starter', label: 'Starter', minEmployees: 1, maxEmployees: 25, monthlyPrice: 10 },
  { tier: 'growth', label: 'Growth', minEmployees: 26, maxEmployees: 100, monthlyPrice: 29 },
  { tier: 'scale', label: 'Scale', minEmployees: 101, maxEmployees: 300, monthlyPrice: 69 },
  { tier: 'business', label: 'Business', minEmployees: 301, maxEmployees: 500, monthlyPrice: 129 },
]

// Which PUBLISHED_BANDS entry `employeeCount` falls in, or null if it's
// above the top published band (Scale tops out at 500 - anything higher is
// the contact-sales/enterprise range). Used by the package-selection UI to
// show "this is your matching Core band" without duplicating the range
// logic pricingCalculator.js's calculateMonthlyPrice() already encodes.
export function bandForEmployeeCount(employeeCount) {
  return PUBLISHED_BANDS.find((band) => employeeCount >= band.minEmployees && employeeCount <= band.maxEmployees) ?? null
}

// The Pulse Check counterpart of bandForEmployeeCount() above, against
// PULSE_CHECK_BANDS' own (different) range boundaries.
export function pulseCheckBandForEmployeeCount(employeeCount) {
  return PULSE_CHECK_BANDS.find((band) => employeeCount >= band.minEmployees && employeeCount <= band.maxEmployees) ?? null
}

// Ordered cheapest-to-most-expensive, matching the tiers produced by
// calculateMonthlyPrice() above (PUBLISHED_BANDS' three tiers, plus
// PROGRESSIVE_PRICING's 'enterprise'). Used to answer "is tier B at least as
// high as tier A" for the plan feature ladder below.
export const PLAN_TIER_ORDER = ['starter', 'growth', 'scale', 'enterprise']

// The feature ladder: which of src/config/featureFlags.js's FEATURE_FLAG_KEYS
// a company's plan unlocks by default at each tier, cumulative - every key
// listed for 'starter' is also included at 'growth', 'scale', and
// 'enterprise', and so on up the ladder. This is the plan side of "lock the
// features according to price": it is what the pricing/billing UI shows as
// included vs. requiring an upgrade, and what a Super Admin configuring a
// company's featureFlags overrides should match against.
//
// Deliberately excludes 'pulseCheck': Pulse Check is not part of any tier's
// included feature set at all. It is a standalone paid add-on (see
// PULSE_CHECK_ADD_ON above), purchased and billed per employee regardless of
// which core tier the company is on - a Starter-tier company can buy it, and
// an Enterprise-tier company does not get it for free. See featureFlags.js's
// comment on the pulseCheck registry entry for the enforcement side of this.
//
// This is a display/guidance mapping only, not a hard runtime gate: the
// actual per-company on/off switch remains companies/{companyId}.featureFlags
// (resolveFeatureFlag in featureFlags.js), set by a Super Admin. Keeping the
// two separate means a Super Admin can still grant a feature above a
// company's tier as a one-off exception without this ladder having to model
// every such exception.
export const PLAN_FEATURES = {
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

// Whether `key` is included in `tier`'s plan. Unknown tier or unknown key
// resolves to false rather than throwing - callers on the pricing/billing UI
// deal with a tier that may not have loaded yet, and a feature key that will
// never be 'pulseCheck' should simply read as "not included" there rather
// than "included in every tier" or "included in none by accident".
export function planIncludesFeature(tier, key) {
  return Boolean(PLAN_FEATURES[tier]?.includes(key))
}

// The lowest tier (in PLAN_TIER_ORDER) whose plan includes `key`, or null if
// no tier includes it (true today only for 'pulseCheck', the add-on). Used
// by the billing UI to tell a locked-out company which plan to upgrade to.
export function lowestTierForFeature(key) {
  return PLAN_TIER_ORDER.find((tier) => planIncludesFeature(tier, key)) ?? null
}

// A plan comparison table's worth of display data - one entry per tier, with
// a headcount range and either a flat monthlyPrice (the three PUBLISHED_
// BANDS tiers) or a startingAt description built from PROGRESSIVE_PRICING
// (enterprise has no single flat price - see calculateMonthlyPrice()).
// Reshapes PUBLISHED_BANDS/PROGRESSIVE_PRICING rather than hardcoding a
// second copy of any number, so this can never drift from what
// calculateMonthlyPrice() would actually quote.
//
// This is what a pricing/billing page shows BEFORE a company necessarily has
// any billable headcount yet (see BillingQuote.jsx: the "no billable
// headcount" case still needs to show what the plans and the Pulse Check
// add-on look like, not render nothing) - unlike a live quote, none of this
// depends on the company's actual roster.
export const PLAN_TIER_SUMMARIES = PLAN_TIER_ORDER.map((tier) => {
  const band = PUBLISHED_BANDS.find((b) => b.tier === tier)
  if (band) {
    return {
      tier,
      label: band.label,
      minEmployees: band.minEmployees,
      maxEmployees: band.maxEmployees,
      monthlyPrice: band.monthlyPrice,
      startingAt: null,
    }
  }
  return {
    tier,
    label: PROGRESSIVE_PRICING.label,
    minEmployees: PUBLISHED_BANDS[PUBLISHED_BANDS.length - 1].maxEmployees + 1,
    maxEmployees: null,
    monthlyPrice: null,
    // e.g. "From $250 + $1.10/employee" - the base fee plus the first (most
    // expensive) marginal bracket, which is what the cheapest possible
    // enterprise quote (the smallest qualifying headcount) actually is.
    startingAt: {
      baseFee: PROGRESSIVE_PRICING.baseFee,
      ratePerEmployee: PROGRESSIVE_PRICING.brackets[0].ratePerEmployee,
    },
  }
})
