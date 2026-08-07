// WHY THIS MATTERS: this is the number a Company Admin sees the instant they
// type a headcount, and it is meant to behave the way a rational pricing
// curve behaves - more employees never costs less, and the per-employee rate
// gets cheaper as a company grows within a pricing regime, never more
// expensive for growing. A regression in either property (an off-by-one that
// drops a bracket, a rounding change that makes price go down as headcount
// goes up) would show up on screen as "we mis-quoted a live prospect," not as
// a caught bug.
//
// NOTE ON WHAT THIS SUITE FOUND: the task asked this suite to also pin
// "continuous at the 500/501 boundary, no cliff." That is not true of the
// current code. calculateMonthlyPrice(500) uses the flat "scale" band
// ($549/mo, $1.098/employee); calculateMonthlyPrice(501) switches to the
// progressive formula applied to the FULL headcount from employee 1 (by
// design - see pricingCalculator.js's and calculateQuote.js's comments), which
// prices 501 employees at $801.10/mo ($1.599/employee). That is a ~46% jump
// in total price, and an INCREASE in effective per-employee rate, for adding
// a single employee. Per instructions this suite does not change production
// pricing logic to make that invariant true - the assertion below pins the
// actual (broken) behavior and is written to fail today, so it reads in test
// output as an open, tracked bug rather than a silently dropped requirement.
import { describe, it, expect } from 'vitest'
import { calculateMonthlyPrice } from '../../../src/utils/pricingCalculator.js'

describe('pricingCalculator', () => {
  it('BUG: is NOT continuous at the 500/501 employee boundary (documents a real price cliff)', () => {
    const at500 = calculateMonthlyPrice(500)
    const at501 = calculateMonthlyPrice(501)

    // What "continuous, no cliff" would require: the price for one more
    // employee should be close to price(500) plus one employee's marginal
    // rate, not dramatically larger. This assertion is written to PASS once
    // the pricing formula only applies the progressive rate to headcount
    // above the flat-band ceiling; today it fails, which is the point - see
    // the file header for the actual numbers.
    const reasonableCeiling = at500.monthlyPrice + 50
    expect(at501.monthlyPrice).toBeLessThanOrEqual(reasonableCeiling)
  })

  it('total monthly price never decreases as headcount grows', () => {
    const sampledCounts = [1, 10, 25, 26, 100, 200, 201, 400, 500, 501, 750, 1000, 1001, 2500, 2501, 5000, 5001, 8000]

    for (let i = 1; i < sampledCounts.length; i += 1) {
      const prev = calculateMonthlyPrice(sampledCounts[i - 1])
      const next = calculateMonthlyPrice(sampledCounts[i])
      expect(next.monthlyPrice).toBeGreaterThanOrEqual(prev.monthlyPrice)
    }
  })

  it('effective per-employee rate strictly decreases as headcount grows within each flat-priced band', () => {
    const bands = [
      [1, 5, 10, 15, 20, 25], // starter
      [26, 50, 100, 150, 200], // growth
      [201, 300, 400, 500], // scale
    ]

    for (const counts of bands) {
      const rates = counts.map((n) => calculateMonthlyPrice(n).effectiveRatePerEmployee)
      for (let i = 1; i < rates.length; i += 1) {
        expect(rates[i]).toBeLessThan(rates[i - 1])
      }
    }
  })

  it('effective per-employee rate strictly decreases as headcount grows within the progressive regime', () => {
    const counts = [501, 750, 1000, 1500, 2500, 3500, 5000, 6000, 8000]
    const rates = counts.map((n) => calculateMonthlyPrice(n).effectiveRatePerEmployee)

    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]).toBeLessThan(rates[i - 1])
    }
  })
})
