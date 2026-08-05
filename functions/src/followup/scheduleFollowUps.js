const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const {
  DAY_MS,
  PROMPT_STATUS,
  normalizeConfig,
  shouldScheduleFor,
  nextScheduledAt,
} = require('./followUpConstants')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const COMPANIES_COLLECTION = 'companies'

// Fires when a case's status transitions to 'closed' - the same trigger
// pattern storeReferenceCase.js uses, and deliberately NOT a modification of
// that file. A follow-up schedule is written onto the case exactly once, at
// the moment of closure, from the per-company cadence config.
//
// This does not reopen or otherwise mutate the closed case's compliance
// artifact - it only appends scheduling metadata (followUpSchedule and the
// two query/mirror fields). The report, action and reference-case record are
// finished and are never touched here.
//
// Retaliation follow-up is not category-specific: a closed burnout or
// harassment case is scheduled just like a retaliation one, because someone
// who reported anything can be retaliated against for having reported. A
// company may disable specific categories in settings, but the default is all
// four on.
exports.scheduleFollowUps = onDocumentUpdated(`${CASES_COLLECTION}/{caseId}`, async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const caseId = event.params.caseId

  const justClosed = after.status === 'closed' && before.status !== 'closed'
  if (!justClosed) return

  // Idempotency: never schedule twice for the same case. A later unrelated
  // update that leaves status at 'closed' is not a fresh transition (justClosed
  // is already false for it), but this also guards a case that was closed,
  // reopened, and closed again from getting a second, overlapping sequence.
  if (Array.isArray(after.followUpSchedule)) return

  const firestore = admin.firestore()

  let config = null
  if (after.companyId) {
    try {
      const companySnap = await firestore.collection(COMPANIES_COLLECTION).doc(after.companyId).get()
      config = companySnap.exists ? companySnap.data().followUpConfig : null
    } catch (err) {
      logger.error('scheduleFollowUps: could not read company config, using defaults', {
        caseId,
        companyId: after.companyId,
        error: err.message,
      })
    }
  }

  if (!shouldScheduleFor(config, after.category)) {
    // Category disabled, or the company set an empty cadence. Nothing is
    // written onto the case - followUpStatus stays absent, which the mirror and
    // the dashboard both read as "no follow-up program for this case".
    return
  }

  const { intervalsDays } = normalizeConfig(config)

  // Base the schedule on when the case actually closed. closedAt is written by
  // caseActions.js's closeCase in the same update that flips status, so it is
  // present on `after`; fall back to now only for a defensive edge (e.g. a
  // status flipped by some other path that didn't stamp closedAt).
  const closedAtMs = after.closedAt?.toMillis?.() ?? Date.now()

  const schedule = intervalsDays.map((days, index) => ({
    index,
    intervalDays: days,
    dueAtMs: closedAtMs + days * DAY_MS,
    status: PROMPT_STATUS.SCHEDULED,
    messageId: null,
    sentAtMs: null,
    answeredAtMs: null,
  }))

  const nextMs = nextScheduledAt(schedule)

  await event.data.after.ref.update({
    followUpSchedule: schedule,
    followUpStatus: PROMPT_STATUS.SCHEDULED,
    nextFollowUpAt: nextMs ? admin.firestore.Timestamp.fromMillis(nextMs) : null,
    followUpOptedOut: false,
    followUpStopped: false,
    followUpFinalizeAt: null,
  })
})
