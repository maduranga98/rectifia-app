// Shared resolver for Module 23 (Data Retention, Deletion & Legal Hold). Not a
// deployed function - every retention-aware Cloud Function (applyRetention.js,
// previewRetention.js) requires this to turn a company doc into the four
// concrete windows that decide what gets purged and when.
//
// Retention here is tiered, not a single switch, because the data behind it has
// three different lifetimes:
//
//   Tier 1 - identity & contact data (reporterIdentity, contactEmail,
//     pushSubscriptions). Shortest life, its own clock.
//   Tier 2 - case content (narrative fields, messages, evidence in Storage).
//     Medium life, measured from case CLOSURE, never from creation.
//   Tier 3 - accountability & statistical residue (referenceCases, the four
//     audit logs, deletionLog). Longest life. referenceCases is indefinite and
//     not configurable at all - see REFERENCE_CASE_RETENTION below - and the
//     audit logs run on auditLogRetentionDays, independently of the case they
//     describe.
//
// FLOORS are not a UX nicety. Employment-claim limitation periods run for
// years after the events a case describes, so a company that could set its
// case window to 30 days would be destroying its own defence evidence before
// a claim period even opens. An admin who genuinely needs to go lower than a
// floor needs a lawyer to change the floor in code and redeploy, not a slider
// in this panel - which is why floors are clamped here and enforced again in
// firestore.rules, and are not configurable by any role, including Super
// Admin, through this module.
const DEFAULTS = {
  identityRetentionDays: 365,
  caseRetentionDays: 2555, // 7 years
  pulseResponseRetentionDays: 730,
  auditLogRetentionDays: 3650,
}

const FLOORS = {
  identityRetentionDays: 90,
  caseRetentionDays: 1095, // 3 years
  pulseResponseRetentionDays: 180,
  auditLogRetentionDays: 2555,
}

// auditLogRetentionDays deliberately has no ceiling: there is no legal-harm
// scenario in keeping an accountability record too long, only in keeping one
// too short.
const CEILINGS = {
  identityRetentionDays: 1825,
  caseRetentionDays: 3650,
  pulseResponseRetentionDays: 1825,
  auditLogRetentionDays: null,
}

// referenceCases holds category, severityScore, evidenceScore, department
// tier, actionTaken and closedAt - no narrative, no names, no identifiers. It
// is the entire basis of the Consistency & Bias Engine (module 10), and
// purging it on the case's clock would mean the company loses its own
// fairness baseline every retention cycle, silently - which is the one thing
// this product is sold on. Keeping pseudonymous scores after deleting the
// narrative they came from is both defensible and necessary, so this value is
// a constant, not a company setting, and no sweep in applyRetention.js ever
// touches that collection.
const REFERENCE_CASE_RETENTION = 'indefinite'

const CONFIGURABLE_KEYS = Object.keys(DEFAULTS)

function clamp(key, value) {
  const floor = FLOORS[key]
  const ceiling = CEILINGS[key]
  let clamped = value
  if (clamped < floor) clamped = floor
  if (typeof ceiling === 'number' && clamped > ceiling) clamped = ceiling
  return clamped
}

// True if `value` is a whole number of days a company could plausibly
// configure - used both to decide whether a stored/proposed override is
// usable at all (an unmaterialized or corrupt value falls back to the
// default, same fail-safe reasoning as functions/src/utils/rateLimit.js's
// resolveLimit) and, unclamped, by the callables that write company config so
// they can reject an out-of-range value outright instead of silently
// clamping an admin's explicit choice.
function isPlausibleDayCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

// Applies a company's retention overrides on top of the defaults and clamps
// every value to its floor/ceiling, so the result is always safe to hand
// straight to applyRetention.js / previewRetention.js even if the stored
// config predates a floor change or was written by a path that didn't
// validate. `companyData` is a company doc's data() (or undefined for a
// company with no retention config at all, which resolves to pure defaults).
function resolveRetentionPolicy(companyData) {
  const stored = companyData?.retention ?? {}
  const resolved = {}
  for (const key of CONFIGURABLE_KEYS) {
    const candidate = stored[key]
    const base = isPlausibleDayCount(candidate) ? candidate : DEFAULTS[key]
    resolved[key] = clamp(key, base)
  }
  return {
    ...resolved,
    referenceCaseRetention: REFERENCE_CASE_RETENTION,
  }
}

module.exports = {
  DEFAULTS,
  FLOORS,
  CEILINGS,
  CONFIGURABLE_KEYS,
  REFERENCE_CASE_RETENTION,
  isPlausibleDayCount,
  clamp,
  resolveRetentionPolicy,
}
