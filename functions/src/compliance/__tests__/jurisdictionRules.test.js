// WHY THIS MATTERS: getStrictestRule() is the sole authoritative source for
// case deadlines (scheduleDeadlines.js, checkOverdueDeadlines.js branch on
// nothing else). If it ever picked a rule other than the genuinely strictest
// one - or fell back to FALLBACK_RULE for a jurisdiction that does have a
// real rule - every deadline computed for that case would be silently wrong.
import { describe, it, expect } from 'vitest'
import {
  JURISDICTION_RULES,
  FALLBACK_RULE,
  getStrictestRule,
} from '../jurisdictionRules.js'

describe('getStrictestRule', () => {
  it("['EU','JP'] returns the EU rule (7-day acknowledgment beats JP's 20-day)", () => {
    expect(getStrictestRule(['EU', 'JP'])).toEqual(JURISDICTION_RULES.EU)
  })

  it("['AU','JP'] returns the JP rule (20-day acknowledgment beats AU's 30-day)", () => {
    expect(getStrictestRule(['AU', 'JP'])).toEqual(JURISDICTION_RULES.JP)
  })

  it("['AU'] returns the AU rule itself, not FALLBACK_RULE", () => {
    const result = getStrictestRule(['AU'])
    expect(result).toEqual(JURISDICTION_RULES.AU)
    expect(result).not.toBe(FALLBACK_RULE)
  })

  it('an empty list returns FALLBACK_RULE', () => {
    expect(getStrictestRule([])).toBe(FALLBACK_RULE)
  })

  it('a list of only unrecognised codes returns FALLBACK_RULE', () => {
    expect(getStrictestRule(['XX'])).toBe(FALLBACK_RULE)
  })
})

describe('JURISDICTION_RULES', () => {
  it('every entry has acknowledgmentDueDays and feedbackDueDays as positive integers', () => {
    for (const [code, rule] of Object.entries(JURISDICTION_RULES)) {
      expect(Number.isInteger(rule.acknowledgmentDueDays), `${code}.acknowledgmentDueDays`).toBe(
        true
      )
      expect(rule.acknowledgmentDueDays, `${code}.acknowledgmentDueDays`).toBeGreaterThan(0)
      expect(Number.isInteger(rule.feedbackDueDays), `${code}.feedbackDueDays`).toBe(true)
      expect(rule.feedbackDueDays, `${code}.feedbackDueDays`).toBeGreaterThan(0)
    }
  })
})
