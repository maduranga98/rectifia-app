const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')
const { notifyCrisisContact } = require('./routeCase')
const { PULSE_INVITES_COLLECTION, verifyInviteToken } = require('./pulseInvites')
const { MIN_RESPONSES_FOR_AGGREGATE, summaryDocId } = require('./pulseThresholds')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')
const { resolveQuestionSet, validateAnswers, describeAnswers } = require('../pulse/questionSet')
const { CORE_QUESTION_IDS } = require('../pulse/coreQuestions')

if (!admin.apps.length) {
  admin.initializeApp()
}

const PULSE_RESPONSES_COLLECTION = 'pulseResponses'
const PULSE_SUMMARIES_COLLECTION = 'pulseSummaries'
const PULSE_SUMMARY_TOTALS_COLLECTION = 'pulseSummaryTotals'
const HISTORY_LOOKBACK = 4

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')
const MODEL = 'claude-haiku-4-5-20251001'

const ANALYSIS_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    sentimentScore: {
      type: 'integer',
      description: 'Overall wellbeing sentiment, 0 (very negative) to 100 (very positive).',
    },
    sentimentSummary: {
      type: 'string',
      description: 'One or two sentence summary of this response, grounded in what was written.',
    },
    themes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short theme tags (e.g. "workload", "manager support").',
    },
    trendFlag: {
      type: 'string',
      enum: ['improving', 'stable', 'declining', 'insufficient_data'],
      description: 'Compares this response against the same employee\'s prior responses given as history.',
    },
    // Reuses the exact crisisFlag semantics module 6 defined for case
    // scoring (functions/src/intake/scoreCase.js) so the same bypass logic
    // (notifyCrisisContact) applies unchanged to pulse responses.
    crisisFlag: {
      type: 'boolean',
      description: 'True only if the response indicates an active safety crisis requiring immediate human attention.',
    },
  },
  required: ['sentimentScore', 'sentimentSummary', 'themes', 'trendFlag', 'crisisFlag'],
  additionalProperties: false,
}

function clampScore(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 50
  return Math.min(100, Math.max(0, Math.round(number)))
}

function currentPeriod() {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

// Submits a pulse response on behalf of a roster employee, who has no Firebase
// Auth account at all - their single-use invite token is the credential
// instead. Identity is NOT client-supplied: companyId, department and
// employeeId are all read off the invite document server-side, so submitting a
// response as someone else is impossible rather than merely discouraged, and
// the payload no longer carries companyId or department at all.
//
// The invite is spent in the SAME transaction that writes the response, so a
// token is genuinely single-use: two racing submissions can't both mark a
// 'pending' invite 'used' and both write a response. employeeId stored here is
// the roster doc id (companies/{companyId}/employees), never a uid - roster
// employees don't have one.
exports.submitPulseResponse = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { inviteId, token, answers } = request.data || {}

  // A submitted response fires analyzePulseResponse below, which is a paid
  // Claude call. The invite is single-use, so this limit is really a guard on
  // repeated failed attempts rather than on successful submissions.
  await enforceRateLimit(admin.firestore(), 'submitPulseResponse', request)
  if (typeof inviteId !== 'string' || typeof token !== 'string' || !inviteId || !token) {
    throw new HttpsError('invalid-argument', 'A valid pulse-check invite is required')
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new HttpsError('invalid-argument', 'answers are required')
  }

  const firestore = admin.firestore()
  const inviteRef = firestore.collection(PULSE_INVITES_COLLECTION).doc(inviteId)
  const responseRef = firestore.collection(PULSE_RESPONSES_COLLECTION).doc()

  // The questionnaire this invite was minted with. Resolving it needs a read of
  // an immutable document that no write depends on, so it happens outside the
  // transaction; the version is re-asserted inside it below.
  //
  // Until module 21 the client was the only definition of a valid response:
  // submitPulseResponse stored whatever {questionId, value} pairs it was given,
  // so an unknown questionId or a scale value of 9000 landed straight in the
  // document the analysis and the department averages are built from. Because
  // the version is stamped at mint time, this validates against the
  // questionnaire the employee was actually sent, not whatever is published now.
  //
  // Resolving here is safe because it produces no observable output. VALIDATING
  // the answers is not, and deliberately does not happen here: an
  // 'invalid-argument' rejection is an oracle for whether a given questionId
  // exists in this company's questionnaire, so it must come only AFTER the
  // token has been verified - which is why the validate call sits inside the
  // transaction below rather than next to this read.
  const preflight = await inviteRef.get()
  if (!preflight.exists) {
    throw new HttpsError('permission-denied', 'Invalid or expired pulse-check invite')
  }
  const inviteQuestionSetVersion = preflight.data().questionSetVersion ?? null
  const questionSet = await resolveQuestionSet(preflight.data().companyId, inviteQuestionSetVersion)

  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(inviteRef)
    if (!snapshot.exists) {
      throw new HttpsError('permission-denied', 'Invalid or expired pulse-check invite')
    }
    const invite = snapshot.data()

    const expired = invite.expiresAt && invite.expiresAt.toMillis() <= Date.now()
    // Single-use enforcement: only a still-pending, unexpired invite whose
    // token matches may be spent, and spending it (status -> 'used') happens
    // right here alongside the response write, never in a separate step.
    if (invite.status !== 'pending' || expired) {
      throw new HttpsError(
        'failed-precondition',
        'This pulse-check invite has already been used or has expired'
      )
    }
    if (!verifyInviteToken(token, invite.tokenHash, invite.tokenSalt)) {
      throw new HttpsError('permission-denied', 'Invalid or expired pulse-check invite')
    }
    // The version is written once at mint time and never updated, so this can
    // only differ if the invite document was tampered with between the
    // preflight read and here - in which case the answers were validated
    // against a set this invite no longer claims, and the submission is refused
    // rather than stored under a version it was not checked against.
    if ((invite.questionSetVersion ?? null) !== inviteQuestionSetVersion) {
      throw new HttpsError('aborted', 'This invite changed while it was being submitted')
    }

    // Only now, with the token verified, is it safe to say anything about what
    // this company's questionnaire contains. Throwing here aborts the
    // transaction, so a rejected submission leaves the invite unspent and
    // still answerable.
    const validatedAnswers = validateAnswers(questionSet, answers)

    tx.set(responseRef, {
      employeeId: invite.employeeId,
      companyId: invite.companyId,
      department: invite.department ?? null,
      // The single-use invite this response spent, in the same transaction
      // that flips it to 'used' below. Module 26's weekly integrity check
      // (functions/src/security/integrityCheck.js) joins on this to confirm
      // no response exists without a genuinely spent invite behind it - the
      // one fact this document could not previously prove on its own.
      inviteId: inviteRef.id,
      answers: validatedAnswers,
      // The questionnaire this response answered. Every later reader - the
      // Claude prompt, the HR response list - resolves the wording through
      // THIS number, never through whatever is published today.
      questionSetVersion: inviteQuestionSetVersion,
      // A staff member's own preview of the real link (see
      // functions/src/pulse/testInvite.js). Excluded from analysis, aggregates,
      // trend history and the HR list by default.
      isTest: invite.isTest === true,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    tx.update(inviteRef, {
      status: 'used',
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })

  return { responseId: responseRef.id }
})

// Keeps only the answers to CORE questions. Used for the history half of the
// trend comparison: core questions are identical across every company and every
// published version by design, so core answers are the one thing that is always
// comparable. Supplementary answers feed theme extraction on the CURRENT
// response and nothing else - never sentimentScore, never trendFlag, never an
// aggregate.
function coreAnswersOnly(answers) {
  return (Array.isArray(answers) ? answers : []).filter((a) =>
    CORE_QUESTION_IDS.includes(a.questionId)
  )
}

// `history` entries are { answers, questionSet, coreVersionChanged } - each
// resolved through ITS OWN questionSetVersion by the caller, so a prior
// response is described with the wording it was actually answering.
async function analyzeWithClaude(answers, questionSet, history) {
  const client = new Anthropic({ apiKey: anthropicApiKey.value() })

  // Prior responses are rendered core-only. A company can add or remove
  // supplementary questions between sends, so including them would mean
  // comparing a response that had five questions against one that had four and
  // reading the difference as a change in how someone feels.
  const historyText = history.length
    ? history
        .map((h, i) => {
          const versionNote = h.coreVersionChanged
            ? '\n  NOTE: the core questions were reworded between this prior response and the ' +
              'current one. Differences in wording are not differences in sentiment.'
            : ''
          return (
            `Prior response ${i + 1} (most recent first), core questions only:\n` +
            `${describeAnswers(h.questionSet, coreAnswersOnly(h.answers))}${versionNote}`
          )
        })
        .join('\n\n')
    : 'No prior responses on file.'

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system:
      'You analyze employee wellness pulse-check survey responses. Assess sentiment, extract themes, ' +
      'flag a longitudinal trend by comparing against the prior responses provided, and flag an active safety ' +
      'crisis only when the current response genuinely indicates one.\n\n' +
      'Questions marked [company-added] are extra questions this employer added. Use them for themes ' +
      'only. Base sentimentScore and trendFlag on the standard questions alone - they are the only ones ' +
      'every employee across every period answers identically, so they are the only comparable ones.\n\n' +
      'Prior responses are shown with the wording that was in front of the employee at the time. If a ' +
      'note says the wording changed, do not read the change in wording as a change in mood.',
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ANALYSIS_OUTPUT_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Current response:\n${describeAnswers(questionSet, answers)}\n\n${historyText}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    return { refused: true }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) throw new Error('Claude response contained no text content')

  const parsed = JSON.parse(textBlock.text)
  return {
    refused: false,
    sentimentScore: clampScore(parsed.sentimentScore),
    sentimentSummary: typeof parsed.sentimentSummary === 'string' ? parsed.sentimentSummary : '',
    themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 10) : [],
    trendFlag: parsed.trendFlag ?? 'insufficient_data',
    crisisFlag: parsed.crisisFlag === true,
  }
}

// Rolls this response into the department/period aggregate that the Manager
// role is allowed to read. This is the ONLY place individual responses ever
// get combined into a summary - Manager-facing views never touch
// pulseResponses directly (firestore.rules denies it outright), so there is
// no client-side filtering step to get wrong.
//
// Two things must stay true of what reaches here, and both are enforced before
// the call rather than inside it:
//   - sentimentScore is derived from CORE answers only (analyzeWithClaude's
//     system prompt), so a company adding a question can never shift a
//     department average, and MIN_RESPONSES_FOR_AGGREGATE keeps meaning what
//     pulseThresholds.js says it means.
//   - test responses never get here at all (the isTest early return in the
//     trigger), so they cannot inflate responseCount toward the floor.
async function updatePulseSummary(firestore, { companyId, department, sentimentScore }) {
  const period = currentPeriod()
  const summaryId = summaryDocId(companyId, department, period)
  const totalsRef = firestore.collection(PULSE_SUMMARY_TOTALS_COLLECTION).doc(summaryId)
  const summaryRef = firestore.collection(PULSE_SUMMARIES_COLLECTION).doc(summaryId)

  await firestore.runTransaction(async (tx) => {
    // The raw accumulator lives ONLY in pulseSummaryTotals (Admin SDK only per
    // firestore.rules). sentimentScoreSum never leaves this collection, so it
    // can never be divided-out client-side to reconstruct an individual score
    // from a below-floor department.
    const snapshot = await tx.get(totalsRef)
    const existing = snapshot.exists ? snapshot.data() : { responseCount: 0, sentimentScoreSum: 0 }
    const responseCount = (existing.responseCount || 0) + 1
    const sentimentScoreSum = (existing.sentimentScoreSum || 0) + sentimentScore
    const suppressed = responseCount < MIN_RESPONSES_FOR_AGGREGATE

    tx.set(
      totalsRef,
      {
        companyId,
        department: department || 'unspecified',
        period,
        responseCount,
        sentimentScoreSum,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    // The Manager-readable projection. It deliberately carries NO
    // sentimentScoreSum - only the finished averageSentiment, and only once the
    // department has crossed MIN_RESPONSES_FOR_AGGREGATE. Below the floor
    // averageSentiment is written as null and suppressed as true, so the number
    // that could re-identify one person's answer is never written into a
    // Manager-readable document in the first place - not filtered out later.
    // suppressed flips to false automatically on the response that crosses the
    // line; firestore.rules keys the Manager / Company Admin read on it.
    tx.set(
      summaryRef,
      {
        companyId,
        department: department || 'unspecified',
        period,
        responseCount,
        suppressed,
        averageSentiment: suppressed ? null : Math.round(sentimentScoreSum / responseCount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  })
}

// Triggered once per newly submitted response. Looks up this employee's last
// few responses for the trend comparison, scores the current one, writes the
// analysis back onto the same doc (readable only by HR Coordinator / Pulse
// Check Reviewer per firestore.rules), rolls it into the aggregate, and - if
// a crisis is flagged - reuses module 6/7's exact crisis-bypass flow rather
// than building a second one.
exports.analyzePulseResponse = onDocumentCreated(
  { document: 'pulseResponses/{responseId}', secrets: [anthropicApiKey] },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return
    const data = snapshot.data()
    const responseId = event.params.responseId
    const firestore = admin.firestore()

    // A test response (functions/src/pulse/testInvite.js) stops here. No Claude
    // call, no sentimentScore, no aggregate, no crisis notification: a staff
    // member checking what the questionnaire looks like must not be able to
    // move a department average, and must not be able to unlock a suppressed
    // one by testing MIN_RESPONSES_FOR_AGGREGATE times.
    if (data.isTest === true) {
      logger.info('analyzePulseResponse: skipping test response', { responseId })
      return
    }

    const currentQuestionSet = await resolveQuestionSet(data.companyId, data.questionSetVersion)

    // Over-fetched, then filtered: a test response sitting in this employee's
    // history would otherwise become a data point in their trend line.
    const historySnapshot = await firestore
      .collection(PULSE_RESPONSES_COLLECTION)
      .where('employeeId', '==', data.employeeId)
      .where('companyId', '==', data.companyId)
      .orderBy('submittedAt', 'desc')
      .limit(HISTORY_LOOKBACK * 2 + 1)
      .get()

    const historyDocs = historySnapshot.docs
      .filter((d) => d.id !== responseId && d.data().isTest !== true)
      .slice(0, HISTORY_LOOKBACK)
      .map((d) => d.data())

    // Each prior response is resolved through ITS OWN version, so it is
    // described with the wording it was answering rather than today's. Where the
    // CORE version differs from the current response's, that is called out in
    // the prompt: a reworded core question must never read as a change in mood.
    const history = await Promise.all(
      historyDocs.map(async (h) => {
        const questionSet = await resolveQuestionSet(data.companyId, h.questionSetVersion)
        return {
          answers: h.answers,
          questionSet,
          coreVersionChanged:
            questionSet.coreVersion != null &&
            currentQuestionSet.coreVersion != null &&
            questionSet.coreVersion !== currentQuestionSet.coreVersion,
        }
      })
    )

    let result
    try {
      result = await analyzeWithClaude(data.answers, currentQuestionSet, history)
    } catch (err) {
      logger.error('analyzePulseResponse: analysis failed', { responseId, error: err.message })
      throw err
    }

    if (result.refused) {
      logger.error('analyzePulseResponse: analysis request was refused', { responseId })
      return
    }

    await snapshot.ref.update({
      sentimentScore: result.sentimentScore,
      sentimentSummary: result.sentimentSummary,
      themes: result.themes,
      trendFlag: result.trendFlag,
      crisisFlag: result.crisisFlag,
      analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await updatePulseSummary(firestore, {
      companyId: data.companyId,
      department: data.department,
      sentimentScore: result.sentimentScore,
    })

    if (result.crisisFlag) {
      await notifyCrisisContact({
        companyId: data.companyId,
        caseId: responseId,
        category: 'pulseCheck',
        severityScore: null,
        evidenceScore: null,
      })
      await snapshot.ref.update({ crisisNotifiedAt: admin.firestore.FieldValue.serverTimestamp() })
    }
  }
)
