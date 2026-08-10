// WHY THIS MATTERS: shouldRunForCompany() is the gate checkOverdueDeadlines.js
// and schedulePulseChecks.js run before touching any per-company data, now
// that both run hourly instead of once a day at a fixed UTC time. Get the DST
// handling wrong and a company either never gets swept (a case blows past its
// escalation window silently) or gets swept at 3am local (the exact
// wrong-time problem this module exists to fix).
import { describe, it, expect } from 'vitest'
import { shouldRunForCompany } from '../companySchedule.js'

describe('shouldRunForCompany', () => {
  it("an Asia/Tokyo company matches targetHour 8 only at 23:00 UTC the previous day", () => {
    const company = { timeZone: 'Asia/Tokyo' }
    expect(shouldRunForCompany(company, 8, new Date('2026-01-01T23:00:00Z'))).toBe(true)
    expect(shouldRunForCompany(company, 8, new Date('2026-01-01T22:00:00Z'))).toBe(false)
    expect(shouldRunForCompany(company, 8, new Date('2026-01-02T00:00:00Z'))).toBe(false)
  })

  it('an Australia/Sydney company gives different UTC hours in January vs July (DST)', () => {
    const company = { timeZone: 'Australia/Sydney' }
    // Sydney is UTC+11 in January (daylight saving) and UTC+10 in July
    // (standard time), so the UTC instant that reads as 8am local shifts by
    // an hour between the two.
    expect(shouldRunForCompany(company, 8, new Date('2026-01-14T21:00:00Z'))).toBe(true)
    expect(shouldRunForCompany(company, 8, new Date('2026-01-14T22:00:00Z'))).toBe(false)
    expect(shouldRunForCompany(company, 8, new Date('2026-07-14T22:00:00Z'))).toBe(true)
    expect(shouldRunForCompany(company, 8, new Date('2026-07-14T21:00:00Z'))).toBe(false)
  })

  it('a null timeZone falls back to UTC', () => {
    expect(shouldRunForCompany({ timeZone: null }, 8, new Date('2026-01-01T08:00:00Z'))).toBe(true)
    expect(shouldRunForCompany({}, 8, new Date('2026-01-01T08:00:00Z'))).toBe(true)
    expect(shouldRunForCompany({ timeZone: null }, 8, new Date('2026-01-01T09:00:00Z'))).toBe(false)
  })

  it('an invalid time zone string falls back to UTC rather than throwing', () => {
    const company = { timeZone: 'Not/AZone' }
    expect(() => shouldRunForCompany(company, 8, new Date('2026-01-01T08:00:00Z'))).not.toThrow()
    expect(shouldRunForCompany(company, 8, new Date('2026-01-01T08:00:00Z'))).toBe(true)
    expect(shouldRunForCompany(company, 8, new Date('2026-01-01T09:00:00Z'))).toBe(false)
  })
})
