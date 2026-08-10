// WHY THIS MATTERS: resolveRetentionPolicy() is what applyRetention.js and
// previewRetention.js hand straight to a purge sweep - a jurisdiction rule
// that fails to tighten a ceiling, or that accidentally loosens a floor,
// means real case/identity data outlives the window a company's own
// jurisdiction requires.
import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  FLOORS,
  CEILINGS,
  REFERENCE_CASE_RETENTION,
  resolveRetentionPolicy,
} from '../retentionPolicy.js'

describe('resolveRetentionPolicy', () => {
  it('a company with no jurisdictions resolves to pure globals', () => {
    const policy = resolveRetentionPolicy({})
    expect(policy.identityRetentionDays).toBe(DEFAULTS.identityRetentionDays)
    expect(policy.caseRetentionDays).toBe(DEFAULTS.caseRetentionDays)
    expect(policy.pulseResponseRetentionDays).toBe(DEFAULTS.pulseResponseRetentionDays)
    expect(policy.auditLogRetentionDays).toBe(DEFAULTS.auditLogRetentionDays)
    expect(policy.resolvedCeilings.caseRetentionDays).toBe(CEILINGS.caseRetentionDays)
    expect(policy.jurisdictionBasis).toEqual([])
  })

  it("['EU'] tightens both default and ceiling", () => {
    const policy = resolveRetentionPolicy({ jurisdictions: ['EU'] })
    expect(policy.caseRetentionDays).toBe(1825)
    expect(policy.identityRetentionDays).toBe(180)
    expect(policy.resolvedCeilings.caseRetentionDays).toBe(2555)
    expect(policy.jurisdictionBasis).toEqual(['EU'])
  })

  it("['EU', 'AU'] takes EU's shorter ceiling and EU's shorter default", () => {
    const policy = resolveRetentionPolicy({ jurisdictions: ['EU', 'AU'] })
    expect(policy.caseRetentionDays).toBe(1825) // EU's shorter default wins
    expect(policy.resolvedCeilings.caseRetentionDays).toBe(2555) // EU's tighter ceiling wins
    expect(policy.jurisdictionBasis).toEqual(['EU', 'AU'])
  })

  it("['AU'] alone keeps the 7-year default", () => {
    const policy = resolveRetentionPolicy({ jurisdictions: ['AU'] })
    expect(policy.caseRetentionDays).toBe(2555) // unchanged 7-year default
    expect(policy.resolvedCeilings.caseRetentionDays).toBe(3650) // AU's raised ceiling
  })

  it('a stored override above the jurisdiction ceiling clamps down to it', () => {
    const policy = resolveRetentionPolicy({
      jurisdictions: ['EU'],
      retention: { caseRetentionDays: 3650 },
    })
    expect(policy.caseRetentionDays).toBe(2555) // clamped to EU ceiling, not global 3650
  })

  it('a stored override below a global floor clamps up to the floor', () => {
    const policy = resolveRetentionPolicy({
      jurisdictions: ['EU'],
      retention: { identityRetentionDays: 30 },
    })
    expect(policy.identityRetentionDays).toBe(FLOORS.identityRetentionDays)
  })

  it('referenceCaseRetention is indefinite in every case', () => {
    const cases = [
      {},
      { jurisdictions: ['EU'] },
      { jurisdictions: ['EU', 'AU'] },
      { jurisdictions: ['AU'] },
      { jurisdictions: ['JP'] },
      { jurisdictions: ['UK', 'US', 'LK'] },
      { jurisdictions: ['EU'], retention: { caseRetentionDays: 1 } },
    ]
    for (const companyData of cases) {
      expect(resolveRetentionPolicy(companyData).referenceCaseRetention).toBe(REFERENCE_CASE_RETENTION)
    }
  })
})
