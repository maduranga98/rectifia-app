import { describe, it, expect } from 'vitest'
import {
  PLAN_FEATURES,
  PLAN_TIER_ORDER,
  PLAN_TIER_SUMMARIES,
  PUBLISHED_BANDS,
  PROGRESSIVE_PRICING,
  planIncludesFeature,
  lowestTierForFeature,
} from '../pricingConfig'
import { FEATURE_FLAG_KEYS } from '../featureFlags'

describe('PLAN_FEATURES', () => {
  it('is keyed by every tier in PLAN_TIER_ORDER, and only those tiers', () => {
    expect(Object.keys(PLAN_FEATURES).sort()).toEqual([...PLAN_TIER_ORDER].sort())
  })

  it('never lists pulseCheck - it is a paid add-on, not part of any tier', () => {
    for (const tier of PLAN_TIER_ORDER) {
      expect(PLAN_FEATURES[tier]).not.toContain('pulseCheck')
    }
  })

  it('only lists real feature-flag keys', () => {
    for (const tier of PLAN_TIER_ORDER) {
      for (const key of PLAN_FEATURES[tier]) {
        expect(FEATURE_FLAG_KEYS).toContain(key)
      }
    }
  })

  it('is cumulative: every feature in a lower tier is also in every higher tier', () => {
    for (let i = 0; i < PLAN_TIER_ORDER.length - 1; i += 1) {
      const lower = PLAN_FEATURES[PLAN_TIER_ORDER[i]]
      const higher = PLAN_FEATURES[PLAN_TIER_ORDER[i + 1]]
      for (const key of lower) {
        expect(higher).toContain(key)
      }
    }
  })

  it('enterprise includes every tier-eligible feature flag', () => {
    const tierEligible = FEATURE_FLAG_KEYS.filter((key) => key !== 'pulseCheck')
    expect(PLAN_FEATURES.enterprise.sort()).toEqual(tierEligible.sort())
  })
})

describe('planIncludesFeature', () => {
  it('is true once a feature enters the ladder, for that tier and every tier above it', () => {
    expect(planIncludesFeature('growth', 'aiFollowUp')).toBe(true)
    expect(planIncludesFeature('scale', 'aiFollowUp')).toBe(true)
    expect(planIncludesFeature('enterprise', 'aiFollowUp')).toBe(true)
  })

  it('is false below the tier that introduces a feature', () => {
    expect(planIncludesFeature('starter', 'aiFollowUp')).toBe(false)
  })

  it('is false for pulseCheck at every tier', () => {
    for (const tier of PLAN_TIER_ORDER) {
      expect(planIncludesFeature(tier, 'pulseCheck')).toBe(false)
    }
  })

  it('is false for an unknown tier rather than throwing', () => {
    expect(planIncludesFeature('nonexistent-tier', 'aiFollowUp')).toBe(false)
    expect(planIncludesFeature(null, 'aiFollowUp')).toBe(false)
    expect(planIncludesFeature(undefined, 'aiFollowUp')).toBe(false)
  })
})

describe('lowestTierForFeature', () => {
  it('returns the cheapest tier that includes the feature', () => {
    expect(lowestTierForFeature('aiFollowUp')).toBe('growth')
    expect(lowestTierForFeature('patternDetection')).toBe('scale')
    expect(lowestTierForFeature('benchmarkPool')).toBe('enterprise')
  })

  it('returns null for pulseCheck - no tier ever includes it', () => {
    expect(lowestTierForFeature('pulseCheck')).toBeNull()
  })
})

describe('PLAN_TIER_SUMMARIES', () => {
  it('has one entry per tier, in PLAN_TIER_ORDER order', () => {
    expect(PLAN_TIER_SUMMARIES.map((s) => s.tier)).toEqual(PLAN_TIER_ORDER)
  })

  it('mirrors PUBLISHED_BANDS exactly for the three flat-price tiers', () => {
    for (const band of PUBLISHED_BANDS) {
      const summary = PLAN_TIER_SUMMARIES.find((s) => s.tier === band.tier)
      expect(summary.monthlyPrice).toBe(band.monthlyPrice)
      expect(summary.minEmployees).toBe(band.minEmployees)
      expect(summary.maxEmployees).toBe(band.maxEmployees)
      expect(summary.startingAt).toBeNull()
    }
  })

  it('gives enterprise no flat price, an open-ended range starting just above scale, and a startingAt built from the base fee and first bracket rate', () => {
    const enterprise = PLAN_TIER_SUMMARIES.find((s) => s.tier === 'enterprise')
    const scaleBand = PUBLISHED_BANDS.find((b) => b.tier === 'scale')

    expect(enterprise.monthlyPrice).toBeNull()
    expect(enterprise.maxEmployees).toBeNull()
    expect(enterprise.minEmployees).toBe(scaleBand.maxEmployees + 1)
    expect(enterprise.startingAt).toEqual({
      baseFee: PROGRESSIVE_PRICING.baseFee,
      ratePerEmployee: PROGRESSIVE_PRICING.brackets[0].ratePerEmployee,
    })
  })
})
