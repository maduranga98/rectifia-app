const { HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { featureFlagsForTier } = require('../billing/pricingEngine')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Server-side copy of src/config/featureFlags.js's registry. Cloud Functions
// deploy separately from the web app and cannot import its source, so this
// is an independent copy of the same key -> default map, not a re-export -
// KEEP IT IN SYNC BY HAND with the client registry. A label is carried here
// too, only so a failed-precondition message can name the feature rather
// than the raw key.
const FEATURE_FLAG_DEFAULTS = {
  // Paid top-up, not a bundled tier feature - see the matching comment on
  // src/config/featureFlags.js's pulseCheck entry. default: false until a
  // Super Admin's explicit override records that the company bought it.
  pulseCheck: { default: false, label: 'Pulse Check' },
  benchmarkPool: { default: false, label: 'Benchmark comparison' },
  aiFollowUp: { default: true, label: 'AI follow-up questions' },
  externalShareLinks: { default: false, label: 'External advisor share links' },
  patternDetection: { default: true, label: 'Pattern detection' },
  burnoutTrendDetection: { default: false, label: 'Burnout trend signals' },
  policyGrounding: { default: true, label: 'Policy-grounded AI' },
}

function requireKnownFlag(key) {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_FLAG_DEFAULTS, key)) {
    // A programming error (a typo'd flag key at a call site), not a runtime
    // condition - the key is always a literal.
    throw new Error(`featureFlags: unknown flag '${key}'`)
  }
  return FEATURE_FLAG_DEFAULTS[key]
}

// Resolves one flag from an already-loaded company document's data (or
// null/undefined if the caller has none). For callers that already hold the
// company doc - e.g. the daily schedulers iterating every company - and
// don't want a second read per flag check.
function resolveFlag(companyData, key) {
  const entry = requireKnownFlag(key)
  const flags = companyData?.featureFlags
  const explicit = flags && typeof flags === 'object' ? flags[key] : undefined
  return typeof explicit === 'boolean' ? explicit : entry.default
}

// Reads companies/{companyId} and resolves one flag. For callables and
// per-document triggers that only have a companyId, not the doc itself.
async function isFeatureEnabled(firestore, companyId, key) {
  requireKnownFlag(key)
  if (!companyId) return false
  const snapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  return resolveFlag(snapshot.exists ? snapshot.data() : null, key)
}

// For onCall functions: throws a failed-precondition HttpsError with a
// uniform, feature-named message if the flag is off. Callers pass the
// already-resolved boolean (from isFeatureEnabled or resolveFlag above) so
// this stays a pure "check and throw" - it never itself decides how the
// flag was resolved.
function requireFeatureEnabled(enabled, key) {
  const entry = requireKnownFlag(key)
  if (!enabled) {
    throw new HttpsError(
      'failed-precondition',
      `${entry.label} is turned off for your company. Ask a Super Admin to enable it.`
    )
  }
}

// One-time write of the PLAN_FEATURES ladder (pricingEngine.js's
// featureFlagsForTier()) into companies/{companyId}.featureFlags whenever a
// self-serve tier change happens (see stripeWebhook.js's syncSelfServeTier).
// Writes each of the six ladder keys as its own dot-path field update, never
// a whole-map overwrite, so featureFlags.pulseCheck - and any other flag key
// outside this ladder - is left completely untouched regardless of its
// current value. This is not a recurring re-sync: a Super Admin's later
// manual override via FeatureFlagPanel.jsx is not reverted by anything else
// here.
async function applyTierFeatureFlags(firestore, companyId, tier) {
  const flags = featureFlagsForTier(tier)
  const update = {}
  for (const [key, value] of Object.entries(flags)) {
    update[`featureFlags.${key}`] = value
  }
  await firestore.collection(COMPANIES_COLLECTION).doc(companyId).update(update)
}

module.exports = {
  FEATURE_FLAG_DEFAULTS,
  resolveFlag,
  isFeatureEnabled,
  requireFeatureEnabled,
  applyTierFeatureFlags,
}
