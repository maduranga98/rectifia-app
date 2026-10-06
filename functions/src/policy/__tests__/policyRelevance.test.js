import { describe, expect, it, vi } from 'vitest'

vi.mock('firebase-admin', () => ({ default: { apps: [1], firestore: vi.fn() }, apps: [1], firestore: vi.fn() }))

const {
  policyAppliesToJurisdictions,
  isProceduralHeading,
  primaryCategories,
  relevantChunks,
} = require('../retrievePolicyContext')

describe('policyAppliesToJurisdictions', () => {
  it('treats a policy with no jurisdictions as Generic', () => {
    expect(policyAppliesToJurisdictions({}, [])).toBe(true)
    expect(policyAppliesToJurisdictions({ jurisdictions: [] }, ['EU'])).toBe(true)
  })
  it('includes Generic and intersecting policies only', () => {
    expect(policyAppliesToJurisdictions({ jurisdictions: ['Generic', 'UK'] }, [])).toBe(true)
    expect(policyAppliesToJurisdictions({ jurisdictions: ['UK'] }, ['UK', 'US'])).toBe(true)
    expect(policyAppliesToJurisdictions({ jurisdictions: ['UK'] }, ['US'])).toBe(false)
    expect(policyAppliesToJurisdictions({ jurisdictions: ['UK'] }, undefined)).toBe(false)
  })
})

describe('cross-category guard', () => {
  it('allows procedural headings and denies outcomes, deny wins', () => {
    expect(isProceduralHeading(['Policy', '3. How to Report'])).toBe(true)
    expect(isProceduralHeading(['Confidentiality'])).toBe(true)
    expect(isProceduralHeading(['Outcomes and Consequences'])).toBe(false)
    expect(isProceduralHeading(['Investigation Process', 'Possible Outcomes'])).toBe(false)
    expect(isProceduralHeading([])).toBe(false)
  })

  const chunk = (id, categories, headingPath) => ({ id, categories, headingPath })
  const chunks = [
    chunk('a', ['burnout'], ['Wellbeing']),
    chunk('b', ['burnout'], ['Workload']),
    chunk('c', ['burnout', 'harassment'], ['How to Report']),
    chunk('d', ['burnout', 'harassment'], ['Consequences']),
  ]

  it('derives the primary category by tag frequency', () => {
    expect([...primaryCategories(chunks)]).toEqual(['burnout'])
  })

  it('keeps everything tagged for a primary category', () => {
    expect(relevantChunks(chunks, 'burnout').map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps only procedural clauses for a non-primary category', () => {
    expect(relevantChunks(chunks, 'harassment').map((c) => c.id)).toEqual(['c'])
  })
})
