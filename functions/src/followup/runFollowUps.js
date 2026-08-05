const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const {
  DAY_MS,
  PROMPT_STATUS,
  PROMPT_TEXT,
  computeRollup,
  nextScheduledAt,
} = require('./followUpConstants')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
const NOTIFICATIONS_COLLECTION = 'notifications'

// How long after the LAST prompt is posted a sequence with no answer is
// settled as 'no_response' (unknown). This is a display-finalization only - it
// posts nothing, chases nobody, and triggers no escalation. It exists purely
// so the dashboard can tell "asked recently, still waiting" ('sent') apart from
// "asked, reporter never returned" ('no_response'), which the rules require be
// labelled explicitly as unknown rather than read as an absence of retaliation.
const NO_RESPONSE_GRACE_DAYS = 30

// Queues a push notification for the reporter. Push is currently non-functional
// (no service worker, and sendCaseUpdate has no live callers), so this only
// enqueues a metadata row for the notifications delivery side to pick up the
// moment push works - exactly the "queue metadata, deliver elsewhere" pattern
// checkOverdueDeadlines.js / schedulePulseChecks.js already use. It never
// blocks or fails the thread post: the durable case-thread message is the
// primary, standalone delivery, and this push is strictly a nice-to-have on top.
async function queuePush(firestore, caseId, companyId) {
  await firestore
    .collection(NOTIFICATIONS_COLLECTION)
    .add({
      type: 'followUpUpdate',
      audience: 'reporter',
      caseId,
      companyId: companyId ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    })
    .catch((err) => {
      logger.error('runFollowUps: could not queue push', { caseId, error: err.message })
    })
}

// Posts one due follow-up prompt into the case thread and marks the schedule
// entry sent. The thread message is the real delivery - the reporter sees it
// whenever they next open the case with their Case ID + passcode.
async function postPrompt(firestore, caseRef, entry) {
  const messageRef = await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'follow_up',
    type: 'follow_up',
    text: PROMPT_TEXT,
    // The reporter answers this in place (FollowUpPrompt.jsx ->
    // submitFollowUpResponse); index ties an answer back to this exact prompt,
    // and kind distinguishes a prompt from the one-off 'new_case' notice a
    // filed retaliation case posts into the same thread.
    followUp: { index: entry.index, kind: 'prompt', status: PROMPT_STATUS.SENT },
    attachments: [],
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
  return messageRef.id
}

async function sendDuePrompts(firestore, nowMs) {
  const now = admin.firestore.Timestamp.fromMillis(nowMs)
  const snapshot = await firestore
    .collection(CASES_COLLECTION)
    .where('nextFollowUpAt', '<=', now)
    .get()

  for (const doc of snapshot.docs) {
    const data = doc.data()
    // The sequence stops the moment a reporter reports a concern or opts out -
    // filtered in code rather than in the query so this needs no composite
    // index on (nextFollowUpAt, followUpStopped).
    if (data.followUpStopped) continue
    if (!Array.isArray(data.followUpSchedule)) continue

    const schedule = data.followUpSchedule.map((e) => ({ ...e }))
    let posted = false

    for (const entry of schedule) {
      if (entry.status !== PROMPT_STATUS.SCHEDULED) continue
      if (entry.dueAtMs > nowMs) continue
      try {
        const messageId = await postPrompt(firestore, doc.ref, entry)
        entry.status = PROMPT_STATUS.SENT
        entry.sentAtMs = nowMs
        entry.messageId = messageId
        posted = true
      } catch (err) {
        logger.error('runFollowUps: could not post prompt', {
          caseId: doc.id,
          index: entry.index,
          error: err.message,
        })
      }
    }

    if (!posted) continue

    const nextMs = nextScheduledAt(schedule)
    // When nothing remains to post, arm the no-response finalization off the
    // most recent send; while more prompts are pending it stays null.
    const lastSentMs = Math.max(...schedule.filter((e) => e.sentAtMs).map((e) => e.sentAtMs))
    const finalizeAtMs = nextMs === null ? lastSentMs + NO_RESPONSE_GRACE_DAYS * DAY_MS : null

    await doc.ref.update({
      followUpSchedule: schedule,
      followUpStatus: computeRollup(schedule, { optedOut: data.followUpOptedOut }),
      nextFollowUpAt: nextMs ? admin.firestore.Timestamp.fromMillis(nextMs) : null,
      followUpFinalizeAt: finalizeAtMs ? admin.firestore.Timestamp.fromMillis(finalizeAtMs) : null,
    })

    await queuePush(firestore, doc.id, data.companyId)
  }
}

// Settles sequences whose last prompt has gone unanswered past the grace
// window: lingering 'sent' entries become 'no_response' (unknown). No message,
// no notification, no action - only the label changes, and a late answer can
// still land because submitFollowUpResponse re-derives from whatever the entry
// is at that time.
async function finalizeNoResponse(firestore, nowMs) {
  const now = admin.firestore.Timestamp.fromMillis(nowMs)
  const snapshot = await firestore
    .collection(CASES_COLLECTION)
    .where('followUpFinalizeAt', '<=', now)
    .get()

  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (data.followUpStopped) continue
    if (!Array.isArray(data.followUpSchedule)) continue

    const schedule = data.followUpSchedule.map((e) =>
      e.status === PROMPT_STATUS.SENT ? { ...e, status: PROMPT_STATUS.NO_RESPONSE } : { ...e }
    )

    await doc.ref.update({
      followUpSchedule: schedule,
      followUpStatus: computeRollup(schedule, { optedOut: data.followUpOptedOut }),
      followUpFinalizeAt: null,
    })
  }
}

// Runs daily. First posts every follow-up prompt that has come due, then
// settles any sequence whose final prompt has gone unanswered long enough to
// call it (unknown, not "no retaliation"). Mirrors checkOverdueDeadlines.js's
// daily-sweep structure.
exports.runFollowUps = onSchedule('every day 02:00', async () => {
  const firestore = admin.firestore()
  const nowMs = Date.now()
  await sendDuePrompts(firestore, nowMs)
  await finalizeNoResponse(firestore, nowMs)
})
