const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { verifyReporterAccess } = require('../intake/caseThread')
const {
  CASES_COLLECTION,
  randomPasscode,
  hashPasscode,
  generateUniqueCaseId,
} = require('../intake/generateCaseAccess')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')
const { ANSWER, ANSWERS, PROMPT_STATUS, computeRollup, nextScheduledAt } = require('./followUpConstants')

if (!admin.apps.length) {
  admin.initializeApp()
}

const MESSAGES_SUBCOLLECTION = 'messages'
const RETALIATION_CATEGORY = 'retaliation'

// Reflects a structured answer onto the message document so the reporter's own
// thread renders the prompt as answered on their next poll.
async function markMessageAnswered(caseRef, entry, answer) {
  if (!entry.messageId) return
  await caseRef
    .collection(MESSAGES_SUBCOLLECTION)
    .doc(entry.messageId)
    .update({ 'followUp.status': entry.status, 'followUp.answer': answer })
    .catch(() => {})
}

// Files the NEW retaliation case. It gets its own Case ID and its own passcode
// (never the original's) - the passcode is returned once to the caller and
// only its salted hash is stored, exactly like submitCase.js. The report is a
// fresh, standalone compliance artifact; nothing about it is written back onto
// the closed original case.
//
// linkedFromCaseId is written onto the new case ONLY when the reporter
// explicitly consented to link. It is one-directional by design: the new
// handler learns the same person filed the earlier case, but the closed case
// - a finished artifact - is never mutated to point forward. When the reporter
// declines (the default), the new case is fully standalone with no reference in
// either direction.
async function fileRetaliationCase(firestore, { originalCaseId, companyId, freeText, link }) {
  const caseId = await generateUniqueCaseId(firestore)
  const passcode = randomPasscode()
  const passcodeSalt = crypto.randomBytes(16).toString('hex')
  const passcodeHash = hashPasscode(passcode, passcodeSalt)

  // The reporter's free text is case content that belongs to the new case's
  // handler - so it lands here, on the new case, as the narrative, and never on
  // the closed original (where it would be visible to the wrong people and
  // mutate a finished record). Downstream scoring needs at least one response,
  // so a neutral standing note is used when the reporter left the field blank.
  const narrative = freeText?.trim()
    ? freeText.trim()
    : 'Filed from a post-closure follow-up check-in. The reporter indicated something had changed since their earlier case closed.'

  const caseDoc = {
    caseId,
    companyId: companyId ?? null,
    passcodeHash,
    passcodeSalt,
    category: RETALIATION_CATEGORY,
    // Same response shape QuestionnaireForm.jsx produces and scoreCase.js /
    // routeCase.js read ({ questionId, type, value }), so the new case scores
    // and routes like any other without those modules needing a special case.
    responses: [{ questionId: 'followUpNarrative', type: 'text', value: narrative }],
    status: 'open',
    tier: 'anonymous',
    source: 'reporter',
    intakeMethod: 'web',
    reportedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }
  if (link) {
    caseDoc.linkedFromCaseId = originalCaseId
  }

  await firestore.collection(CASES_COLLECTION).doc(caseId).set(caseDoc)

  return { caseId, passcode }
}

// Records a reporter's answer to a follow-up prompt, over the same anonymous
// Case ID + passcode channel every reporter action uses. No identity, email or
// phone is ever requested or stored here.
//
// A positive ('something has happened') response never reopens the closed case
// and never auto-creates a retaliation case. It offers the reporter the choice
// to file one; only if they ask (fileRetaliationCase) is a new case created,
// and only if they separately consent (linkToOriginal, default off) is it
// linked. The reporter is always free to answer 'nothing has changed', decline,
// or opt out, with no consequence and no chasing.
exports.submitFollowUpResponse = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const {
    caseId,
    passcode,
    answer,
    freeText,
    fileRetaliationCase: wantsToFile = false,
    linkToOriginal = false,
  } = request.data || {}

  const firestore = admin.firestore()
  // Rate limited before the passcode check, so the limiter can't distinguish a
  // real Case ID from an invented one - same discipline as caseThread.js.
  await enforceRateLimit(firestore, 'submitFollowUpResponse', request)
  const snapshot = await verifyReporterAccess(firestore, caseId, passcode)

  const caseRef = snapshot.ref
  const data = snapshot.data()
  if (!Array.isArray(data.followUpSchedule)) {
    throw new HttpsError('failed-precondition', 'This case has no follow-up to respond to')
  }

  const schedule = data.followUpSchedule.map((e) => ({ ...e }))

  // Two entry points: answering a live prompt, or - having already answered
  // 'something happened' earlier - coming back to file the retaliation case the
  // reporter deferred. The latter carries no answer, only fileRetaliationCase.
  const filingOnly = !answer && wantsToFile

  let entry
  if (filingOnly) {
    entry = [...schedule].reverse().find(
      (e) => e.status === PROMPT_STATUS.ANSWERED_CONCERN && !e.filedCaseId
    )
    if (!entry) {
      throw new HttpsError('failed-precondition', 'There is no reported concern awaiting a filed case')
    }
  } else {
    if (!ANSWERS.has(answer)) {
      throw new HttpsError('invalid-argument', `answer must be one of ${[...ANSWERS].join(', ')}`)
    }
    // The most recent prompt that was actually posted and is still open.
    entry = [...schedule].reverse().find((e) => e.status === PROMPT_STATUS.SENT)
    if (!entry) {
      throw new HttpsError('failed-precondition', 'There is no follow-up prompt awaiting a response')
    }

    const nowMs = Date.now()
    if (answer === ANSWER.NO_CHANGE) {
      entry.status = PROMPT_STATUS.ANSWERED_NO_CHANGE
    } else if (answer === ANSWER.CONCERN) {
      entry.status = PROMPT_STATUS.ANSWERED_CONCERN
    } else if (answer === ANSWER.DECLINE) {
      // "I would rather not answer" - this one prompt is declined, but the
      // sequence continues; the reporter may answer a later one.
      entry.status = PROMPT_STATUS.DECLINED
    } else if (answer === ANSWER.STOP) {
      // "Stop asking me" - an explicit opt-out ends the whole sequence.
      entry.status = PROMPT_STATUS.DECLINED
    }
    entry.answeredAtMs = nowMs
    await markMessageAnswered(caseRef, entry, answer)
  }

  const reportedConcern = entry.status === PROMPT_STATUS.ANSWERED_CONCERN
  const optedOut = data.followUpOptedOut || answer === ANSWER.STOP
  // The sequence stops early on a reported concern or an explicit opt-out, and
  // never sends more than the configured number of prompts otherwise.
  const stopped = data.followUpStopped || reportedConcern || answer === ANSWER.STOP

  let filed = null
  if (reportedConcern && wantsToFile) {
    filed = await fileRetaliationCase(firestore, {
      originalCaseId: caseId,
      companyId: data.companyId,
      freeText,
      link: linkToOriginal === true,
    })
    entry.filedCaseId = filed.caseId

    // A durable notice in the ORIGINAL thread that a new case was filed, so the
    // reporter has a record of its Case ID. The passcode is deliberately NOT
    // written here - it is returned once in this response and lives nowhere
    // else, the same one-time contract every case passcode has.
    await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
      sender: 'follow_up',
      type: 'follow_up',
      text:
        `A new, separate case has been opened for you: ${filed.caseId}. ` +
        (linkToOriginal === true
          ? 'You chose to link it to this case, so its handler will know the same person filed both. '
          : 'It is standalone and carries no reference to this case. ') +
        'Its passcode is shown to you once now - please save it, as it cannot be recovered.',
      followUp: { kind: 'new_case', newCaseId: filed.caseId, linked: linkToOriginal === true },
      attachments: [],
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  const nextMs = stopped ? null : nextScheduledAt(schedule)

  await caseRef.update({
    followUpSchedule: schedule,
    followUpStatus: computeRollup(schedule, { optedOut }),
    followUpOptedOut: optedOut,
    followUpStopped: stopped,
    nextFollowUpAt: nextMs ? admin.firestore.Timestamp.fromMillis(nextMs) : null,
    // Once stopped there is nothing left to finalize; while running, leave the
    // finalization arm to runFollowUps.js.
    ...(stopped ? { followUpFinalizeAt: null } : {}),
  })

  // The passcode is returned exactly once here and nowhere else.
  return filed
    ? { recorded: true, filed: true, newCaseId: filed.caseId, newPasscode: filed.passcode, linked: linkToOriginal === true }
    : { recorded: true, filed: false }
})
