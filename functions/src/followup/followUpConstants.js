// Shared vocabulary and pure helpers for the retaliation follow-up module,
// so the onUpdate trigger (scheduleFollowUps.js), the daily sweep
// (runFollowUps.js) and the reporter-facing callable
// (submitFollowUpResponse.js) can never disagree about what a status means,
// what the default cadence is, or how the per-case rollup is derived.
//
// Nothing here calls Firestore, an LLM, or anything with side effects - the
// prompt is fixed copy and the answers are a closed enum, on purpose: an LLM
// would add cost and inference risk to a flow whose whole point is to be
// neutral and predictable.

const DAY_MS = 24 * 60 * 60 * 1000

// Days after closure, by default, at which each follow-up is posted. A
// per-company config value (companies/{companyId}.followUpConfig) overrides
// this; these are only the fallback when a company never configured a cadence.
const DEFAULT_INTERVAL_DAYS = [30, 60, 90]

// All four v1 categories are followed up by default. Retaliation is not
// category-specific - someone who reported burnout can be retaliated against
// too - so a company opts categories OUT explicitly rather than opting in.
const ALL_CATEGORIES = ['harassment', 'toxicManagement', 'retaliation', 'burnout']

// Per-prompt statuses. 'no_response' is the terminal label for a prompt that
// was posted and never answered - it means UNKNOWN, and must never be read,
// aggregated, or shown as evidence that no retaliation occurred. An anonymous
// reporter who never returns is the expected case, not a negative signal.
const PROMPT_STATUS = {
  SCHEDULED: 'scheduled',
  SENT: 'sent',
  ANSWERED_NO_CHANGE: 'answered_no_change',
  ANSWERED_CONCERN: 'answered_concern',
  DECLINED: 'declined',
  NO_RESPONSE: 'no_response',
}

// The structured answers a reporter can give. Free text is optional and always
// separate from these - see submitFollowUpResponse.js for why the free text
// never lands on the closed case.
const ANSWER = {
  NO_CHANGE: 'no_change',
  CONCERN: 'concern',
  DECLINE: 'decline',
  STOP: 'stop',
}
const ANSWERS = new Set(Object.values(ANSWER))

// The fixed, neutral prompt copy. Deliberately does not suggest retaliation is
// expected, likely, or common, and asks nothing leading. Kept here as one
// constant so every posted prompt is byte-for-byte identical and reviewable in
// one place.
const PROMPT_TEXT =
  'Your case has been closed for a while now. As a routine check-in: has anything ' +
  'changed for you since you filed it? There is no need to answer, and answering ' +
  "'nothing has changed' is completely fine."

// Normalizes a company's stored followUpConfig into a shape the schedulers can
// rely on. A missing or malformed config falls back to the defaults rather
// than throwing - a company that never opened the settings page still gets the
// default follow-ups on all categories, which is the intended default-on
// behavior.
function normalizeConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {}

  const intervals = Array.isArray(config.intervalsDays)
    ? config.intervalsDays
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0)
    : DEFAULT_INTERVAL_DAYS
  // De-duplicate and sort ascending so prompts are always posted in time order
  // and two intervals set to the same day don't produce two prompts at once.
  const intervalsDays = [...new Set(intervals)].sort((a, b) => a - b)

  const disabledCategories = Array.isArray(config.disabledCategories)
    ? config.disabledCategories.filter((c) => ALL_CATEGORIES.includes(c))
    : []

  return {
    // An empty intervals list is a valid, explicit "no follow-ups" choice, kept
    // distinct from an absent config (which yields the defaults above).
    intervalsDays: Array.isArray(config.intervalsDays) ? intervalsDays : DEFAULT_INTERVAL_DAYS,
    disabledCategories,
  }
}

// Whether a closed case in this category, for this company, should be followed
// up at all.
function shouldScheduleFor(config, category) {
  const normalized = normalizeConfig(config)
  if (normalized.intervalsDays.length === 0) return false
  if (normalized.disabledCategories.includes(category)) return false
  return true
}

// The per-case rollup the HR Coordinator dashboard sees as metadata (via the
// caseMetadata mirror). It is derived purely from the schedule array plus the
// opt-out flag - HR never sees the individual answers or any free text, only
// this single coarse status and the counts built from it.
//
// While the sequence is still running the rollup reflects progress
// ('scheduled' / 'sent'). It only settles on 'no_response' once
// runFollowUps.js has explicitly finalized the sequence (see NO_RESPONSE
// finalization there) - it is never inferred from silence alone mid-sequence,
// because "we asked yesterday and are waiting" is not the same as "the reporter
// never came back", and only the latter is the unknown 'no_response' means.
function computeRollup(schedule, { optedOut = false } = {}) {
  const statuses = schedule.map((e) => e.status)
  if (optedOut) return PROMPT_STATUS.DECLINED
  if (statuses.includes(PROMPT_STATUS.ANSWERED_CONCERN)) return PROMPT_STATUS.ANSWERED_CONCERN
  if (statuses.includes(PROMPT_STATUS.SCHEDULED)) return PROMPT_STATUS.SCHEDULED
  if (statuses.includes(PROMPT_STATUS.SENT)) return PROMPT_STATUS.SENT
  if (statuses.includes(PROMPT_STATUS.ANSWERED_NO_CHANGE)) return PROMPT_STATUS.ANSWERED_NO_CHANGE
  if (statuses.includes(PROMPT_STATUS.NO_RESPONSE)) return PROMPT_STATUS.NO_RESPONSE
  if (statuses.includes(PROMPT_STATUS.DECLINED)) return PROMPT_STATUS.DECLINED
  return PROMPT_STATUS.NO_RESPONSE
}

// The earliest still-scheduled prompt time, or null when nothing remains to
// post. runFollowUps.js queries on this, and syncCaseMetadata.js mirrors it.
function nextScheduledAt(schedule) {
  const pending = schedule
    .filter((e) => e.status === PROMPT_STATUS.SCHEDULED)
    .map((e) => e.dueAtMs)
    .sort((a, b) => a - b)
  return pending.length > 0 ? pending[0] : null
}

module.exports = {
  DAY_MS,
  DEFAULT_INTERVAL_DAYS,
  ALL_CATEGORIES,
  PROMPT_STATUS,
  ANSWER,
  ANSWERS,
  PROMPT_TEXT,
  normalizeConfig,
  shouldScheduleFor,
  computeRollup,
  nextScheduledAt,
}
