// The per-company feature flag registry: every flag Rectifia can turn on or
// off for one company, its Super-Admin-facing label/description, and its
// default when the company has no explicit override.
//
// Flags live at companies/{companyId}.featureFlags as a flat { [key]: boolean }
// map. A key that is absent from that map - which is every company today,
// and any company created after a new flag is added here - falls back to
// this registry's `default`, so adding a flag never needs a backfill
// migration across existing companies.
//
// Cloud Functions run as a completely separate deploy from this app and
// cannot import from src/, so functions/src/utils/featureFlags.js carries an
// independent copy of this same registry for server-side enforcement. THE
// TWO MUST BE KEPT IN SYNC BY HAND: adding, renaming, or re-defaulting a flag
// here and not there is a silent client/server disagreement about what a
// company opted into.
//
// Deliberately excludes the core reporting path. submitCase, scoreCase,
// routeCase, the case thread, the compliance deadline clock, and evidence
// upload are not optional - a flag that could switch one of those off would
// be a compliance hazard sitting in a settings panel, not a feature toggle.
export const FEATURE_FLAGS = {
  // Pulse Check is a paid top-up, not a bundled tier feature - see
  // PLAN_FEATURES in src/config/pricingConfig.js, which deliberately excludes
  // this key from every tier's included-feature list, and PULSE_CHECK_BANDS
  // for its published-band price. `default: false` means a company gets no
  // Pulse Check module until a Super Admin turns this flag on for them (the
  // same override write FeatureFlagPanel.jsx already makes for every other
  // flag) - that toggle is how "the company purchased the add-on" is
  // recorded, there being no separate purchase-state field.
  pulseCheck: {
    label: 'Pulse Check',
    description:
      'The employee wellbeing survey module: the questionnaire, invite sending, and department sentiment trends. Paid add-on, priced by published band - not included in any plan tier by default.',
    default: false,
  },
  benchmarkPool: {
    label: 'Benchmark comparison',
    description:
      'Cross-company anonymized benchmark comparison against other opted-in companies in the same industry and size band.',
    default: false,
  },
  aiFollowUp: {
    label: 'AI follow-up questions',
    description:
      'Automated AI-generated follow-up questions posted into the case thread when the reporter’s account leaves an evidence gap.',
    default: true,
  },
  externalShareLinks: {
    label: 'External advisor share links',
    description:
      'Lets a Case Handler send a time-limited, revocable read-only link to an external party (e.g. outside counsel) for one case.',
    default: false,
  },
  patternDetection: {
    label: 'Pattern detection',
    description:
      'Subject-signature pattern signals surfaced across the case pool, so a cluster of reports about the same person is visible.',
    default: true,
  },
  burnoutTrendDetection: {
    label: 'Burnout trend signals',
    description:
      'Department-level burnout report volume surfaced to HR Coordinators, separate from and weaker than subject-based pattern detection - no accused party, no per-person clustering.',
    default: false,
  },
  policyGrounding: {
    label: 'Policy-grounded AI',
    description:
      'Injects the company’s own uploaded policy passages as reference context into case scoring and checklist generation.',
    default: true,
  },
}

export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS)

function isKnownFlag(key) {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, key)
}

// The full flag map for a company that has never touched any override -
// every key at its registry default. Not what a real company's map looks
// like (most companies' featureFlags is a partial override, or absent
// entirely) - useful for seeding a form with "what would apply right now".
export function defaultFeatureFlags() {
  const out = {}
  for (const key of FEATURE_FLAG_KEYS) out[key] = FEATURE_FLAGS[key].default
  return out
}

// The one function that answers "is this flag on for this company", given
// whatever companies/{companyId}.featureFlags currently holds (which may be
// undefined, null, or missing this specific key). An explicit boolean
// override wins; anything else - the key absent, the map absent, a
// non-boolean value some older write left behind - resolves to the
// registry default.
export function resolveFeatureFlag(companyFeatureFlags, key) {
  if (!isKnownFlag(key)) {
    throw new Error(`resolveFeatureFlag: unknown flag '${key}'`)
  }
  const explicit = companyFeatureFlags ? companyFeatureFlags[key] : undefined
  return typeof explicit === 'boolean' ? explicit : FEATURE_FLAGS[key].default
}

// Whether companies/{companyId}.featureFlags carries its own explicit value
// for this key, as opposed to falling through to the registry default. The
// Super Admin panel uses this to show "override" vs "using default" next to
// the resolved value.
export function hasExplicitFeatureFlag(companyFeatureFlags, key) {
  return typeof companyFeatureFlags?.[key] === 'boolean'
}
