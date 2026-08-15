import { describe, it, expect, vi, afterEach } from 'vitest'
import { regionFromTimeZone } from '../regionFromTimeZone'

function mockTimeZone(timeZone) {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
    resolvedOptions: () => ({ timeZone }),
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('regionFromTimeZone', () => {
  const mapped = [
    ['Europe/London', 'UK'],
    ['Europe/Paris', 'EU'],
    ['Europe/Berlin', 'EU'],
    ['Europe/Madrid', 'EU'],
    ['America/New_York', 'US'],
    ['America/Chicago', 'US'],
    ['America/Denver', 'US'],
    ['America/Phoenix', 'US'],
    ['America/Los_Angeles', 'US'],
    ['America/Anchorage', 'US'],
    ['Pacific/Honolulu', 'US'],
    ['US/Eastern', 'US'],
    ['Australia/Sydney', 'AU'],
    ['Australia/Perth', 'AU'],
    ['Asia/Tokyo', 'JP'],
    ['Asia/Colombo', 'LK'],
  ]

  it.each(mapped)('resolves %s to %s', (timeZone, region) => {
    mockTimeZone(timeZone)
    expect(regionFromTimeZone()).toBe(region)
  })

  it('returns null for America/Toronto (unmapped, not guessed as US)', () => {
    mockTimeZone('America/Toronto')
    expect(regionFromTimeZone()).toBeNull()
  })

  it('returns null for Pacific/Auckland (unmapped, not guessed as AU)', () => {
    mockTimeZone('Pacific/Auckland')
    expect(regionFromTimeZone()).toBeNull()
  })

  it('returns null when Intl.DateTimeFormat throws', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('unsupported')
    })
    expect(regionFromTimeZone()).toBeNull()
  })
})
