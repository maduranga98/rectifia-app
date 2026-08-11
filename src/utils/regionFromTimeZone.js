// Resolves a Rectifia jurisdiction hint from the browser's own IANA time
// zone - never geolocation, never an IP lookup, nothing transmitted anywhere.
// This is a display hint computed and discarded on the page: which regional
// crisis resources to show first (see crisisResources.js's resolveResources),
// nothing more.
//
// The mapping is explicit, not prefix-derived, aside from the two
// continent-wide zone families called out below. An unmapped zone returns
// null rather than a nearby guess - `America/Toronto` and `Pacific/Auckland`
// must never resolve to 'US' or 'AU'.

const US_ZONES = new Set([
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  // Common aliases for the same zones above.
  'US/Eastern',
  'US/Central',
  'US/Mountain',
  'US/Arizona',
  'US/Pacific',
  'US/Alaska',
  'US/Hawaii',
])

// Europe/* zones of EU member states only. Cyprus (Asia/Nicosia) has no
// Europe/ zone and is intentionally left unmapped rather than guessed.
const EU_ZONES = new Set([
  'Europe/Vienna',
  'Europe/Brussels',
  'Europe/Sofia',
  'Europe/Zagreb',
  'Europe/Prague',
  'Europe/Copenhagen',
  'Europe/Tallinn',
  'Europe/Helsinki',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Athens',
  'Europe/Budapest',
  'Europe/Dublin',
  'Europe/Rome',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Luxembourg',
  'Europe/Malta',
  'Europe/Amsterdam',
  'Europe/Warsaw',
  'Europe/Lisbon',
  'Europe/Bucharest',
  'Europe/Bratislava',
  'Europe/Ljubljana',
  'Europe/Madrid',
  'Europe/Stockholm',
])

export function regionFromTimeZone() {
  let zone
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return null
  }

  if (typeof zone !== 'string') return null
  if (zone === 'Europe/London') return 'UK'
  if (zone === 'Asia/Tokyo') return 'JP'
  if (zone === 'Asia/Colombo') return 'LK'
  if (US_ZONES.has(zone)) return 'US'
  if (EU_ZONES.has(zone)) return 'EU'
  if (zone.startsWith('Australia/')) return 'AU'

  return null
}
