// Resolves whether a per-company hourly sweep should act on a given company
// right now, based on that company's local time rather than a single UTC
// hour for every company on the planet. Used by checkOverdueDeadlines.js and
// schedulePulseChecks.js, both of which now run 'every 1 hours' and gate on
// this before doing anything else - see the comment on shouldRunForCompany
// below for why the gate has to be cheap.
const DEFAULT_TIME_ZONE = 'UTC'

// Formatting a fixed instant in a given IANA zone with hourCycle 'h23' is
// what correctly accounts for DST - a company in Australia/Sydney sits at a
// different UTC offset in January than in July, and manual UTC-offset
// arithmetic would not track that transition. An invalid or missing zone
// throws inside Intl.DateTimeFormat's constructor, which resolveLocalHour
// catches and falls back to UTC - a misconfigured company still gets swept
// on the UTC schedule, it is never silently skipped.
function resolveLocalHour(timeZone, now) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TIME_ZONE,
      hourCycle: 'h23',
      hour: '2-digit',
    })
    const hourPart = formatter.formatToParts(now).find((part) => part.type === 'hour')
    return Number.parseInt(hourPart.value, 10) % 24
  } catch {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIME_ZONE,
      hourCycle: 'h23',
      hour: '2-digit',
    })
    const hourPart = formatter.formatToParts(now).find((part) => part.type === 'hour')
    return Number.parseInt(hourPart.value, 10) % 24
  }
}

// true when it is currently targetHour in `companyData`'s local time zone.
// This is the first thing each hourly iteration does, before any per-company
// Firestore query - hourly execution is already ~24x the invocations of the
// old daily schedule, so a company whose local hour doesn't match must cost
// nothing beyond the company-doc read the caller already did to get here.
function shouldRunForCompany(companyData, targetHour, now = new Date()) {
  return resolveLocalHour(companyData?.timeZone, now) === targetHour
}

module.exports = { shouldRunForCompany, resolveLocalHour, DEFAULT_TIME_ZONE }
