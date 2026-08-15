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

// Per-jurisdiction overrides on top of DEFAULTS/CEILINGS, keyed by the same
// codes companies.jurisdictions uses. Each entry supplies only the keys it
// needs to override - anything absent falls through to the global default or
// ceiling above. These are engineering defaults pending employment-law
// review, not legal advice; a jurisdiction with no entry (UK, US, LK) means
// the existing globals already reflect it, not that it was overlooked.
const JURISDICTION_RETENTION = {
  // GDPR Art. 5(1)(e) storage limitation pushes toward the shortest window
  // that still serves the purpose: a 5-year case window and a 6-month
  // post-closure identity window are the conservative reading. The ceiling
  // matters more than the default here - an EU company should not be able
  // to configure a 10-year case window regardless of what it sets. Pending
  // employment-law review - this is an engineering default, not legal
  // advice.
  EU: {
    caseRetentionDays: 1825, // 5 years
    identityRetentionDays: 180, // 6 months
    caseRetentionCeiling: 2555, // 7 years
  },
  // Japan's labour-related record-keeping obligations sit around 5 years
  // post the 2020 Civil Code amendment; 5 years is the defensible default,
  // with room up to 10 years for a company that needs it. Pending
  // employment-law review - this is an engineering default, not legal
  // advice.
  JP: {
    caseRetentionDays: 1825, // 5 years
    caseRetentionCeiling: 3650, // 10 years
  },
  // Australia's Fair Work Act record-keeping expectations and
  // employment-claim limitation periods both favour the longer end; the
  // existing 7-year global default is already the right shape, so this
  // entry only raises the ceiling to give a company room above it. Pending
  // employment-law review - this is an engineering default, not legal
  // advice.
  AU: {
    caseRetentionDays: 2555, // 7 years
    caseRetentionCeiling: 3650, // 10 years
  },
  // UK, US and LK have no entry: the existing global DEFAULTS/CEILINGS
  // already reflect them, so there is nothing to override.
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

// A jurisdiction override's ceiling for `key` is stored under
// `${key}Ceiling` (e.g. caseRetentionDays -> caseRetentionCeiling) rather
// than in a parallel CEILINGS-shaped object, since most jurisdiction entries
// only ever touch caseRetentionDays.
function jurisdictionCeilingKey(key) {
  return key.replace(/Days$/, 'Ceiling')
}

// Folds a company's jurisdictions into a single set of per-key defaults and
// ceilings, strictest-wins: for each configurable key, the shortest default
// and the shortest ceiling among the company's matching jurisdictions win,
// the same reasoning getStrictestRule() in
// functions/src/compliance/jurisdictionRules.js applies to deadlines - a
// company operating in EU+AU is bound by the EU's tighter ceiling, not
// whichever jurisdiction happens to be listed first. Jurisdictions with no
// entry in JURISDICTION_RETENTION (or not in JURISDICTION_RETENTION at all)
// simply don't contribute; a company with none resolves to the untouched
// global DEFAULTS/CEILINGS.
function resolveJurisdictionRetention(jurisdictions = []) {
  const basis = (jurisdictions || []).filter((code) => JURISDICTION_RETENTION[code])
  const defaults = { ...DEFAULTS }
  const ceilings = { ...CEILINGS }

  for (const key of CONFIGURABLE_KEYS) {
    const ceilingKey = jurisdictionCeilingKey(key)
    for (const code of basis) {
      const entry = JURISDICTION_RETENTION[code]
      if (typeof entry[key] === 'number' && entry[key] < defaults[key]) {
        defaults[key] = entry[key]
      }
      if (typeof entry[ceilingKey] === 'number') {
        if (typeof ceilings[key] !== 'number' || entry[ceilingKey] < ceilings[key]) {
          ceilings[key] = entry[ceilingKey]
        }
      }
    }
  }

  return { defaults, ceilings, basis }
}

// Applies a company's retention overrides on top of the defaults and clamps
// every value to its floor/ceiling, so the result is always safe to hand
// straight to applyRetention.js / previewRetention.js even if the stored
// config predates a floor change or was written by a path that didn't
// validate. `companyData` is a company doc's data() (or undefined for a
// company with no retention config at all, which resolves to pure defaults).
//
// Resolution order, strictest-wins, all in one place:
//   1. Start from the global DEFAULTS/CEILINGS.
//   2. Fold in the company's jurisdictions (resolveJurisdictionRetention) -
//      shortest default, shortest ceiling, per key.
//   3. Apply the company's own stored `retention` overrides on top.
//   4. Clamp against the global FLOORS (unchanged, jurisdiction-proof) and
//      the jurisdiction-resolved ceiling from step 2.
// A jurisdiction can tighten a ceiling but can never loosen or lower a
// floor - FLOORS stay global because they are the one thing firestore.rules
// also knows about and enforces independently.
function resolveRetentionPolicy(companyData) {
  const stored = companyData?.retention ?? {}
  const { defaults, ceilings, basis } = resolveJurisdictionRetention(companyData?.jurisdictions)

  const resolved = {}
  const resolvedCeilings = {}
  for (const key of CONFIGURABLE_KEYS) {
    const candidate = stored[key]
    const base = isPlausibleDayCount(candidate) ? candidate : defaults[key]
    const floor = FLOORS[key]
    const ceiling = ceilings[key]
    let clamped = base
    if (clamped < floor) clamped = floor
    if (typeof ceiling === 'number' && clamped > ceiling) clamped = ceiling
    resolved[key] = clamped
    resolvedCeilings[key] = ceiling
  }

  return {
    ...resolved,
    referenceCaseRetention: REFERENCE_CASE_RETENTION,
    resolvedCeilings,
    jurisdictionBasis: basis,
  }
}

module.exports = {
  DEFAULTS,
  FLOORS,
  CEILINGS,
  JURISDICTION_RETENTION,
  CONFIGURABLE_KEYS,
  REFERENCE_CASE_RETENTION,
  isPlausibleDayCount,
  clamp,
  resolveJurisdictionRetention,
  resolveRetentionPolicy,
}
