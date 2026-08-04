const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')
const { notifyCrisisContact } = require('./routeCase')
const { PULSE_INVITES_COLLECTION, verifyInviteToken } = require('./pulseInvites')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

const PULSE_RESPONSES_COLLECTION = 'pulseResponses'
const PULSE_SUMMARIES_COLLECTION = 'pulseSummaries'
const HISTORY_LOOKBACK = 4

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')
const MODEL = 'claude-opus-5'

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

    tx.set(responseRef, {
      employeeId: invite.employeeId,
      companyId: invite.companyId,
      department: invite.department ?? null,
      answers,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    tx.update(inviteRef, {
      status: 'used',
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })

  return { responseId: responseRef.id }
})

async function analyzeWithClaude(answers, history) {
  const client = new Anthropic({ apiKey: anthropicApiKey.value() })

  const historyText = history.length
    ? history
        .map((h, i) => `Prior response ${i + 1} (most recent first): ${JSON.stringify(h.answers)}`)
        .join('\n')
    : 'No prior responses on file.'

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system:
      'You analyze employee wellness pulse-check survey responses. Assess sentiment, extract themes, ' +
      'flag a longitudinal trend by comparing against the prior responses provided, and flag an active safety ' +
      'crisis only when the current response genuinely indicates one.',
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ANALYSIS_OUTPUT_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Current response: ${JSON.stringify(answers)}\n\n${historyText}`,
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
async function updatePulseSummary(firestore, { companyId, department, sentimentScore }) {
  const period = currentPeriod()
  const summaryId = `${companyId}__${department || 'unspecified'}__${period}`
  const ref = firestore.collection(PULSE_SUMMARIES_COLLECTION).doc(summaryId)

  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const existing = snapshot.exists ? snapshot.data() : { responseCount: 0, sentimentScoreSum: 0 }
    tx.set(
      ref,
      {
        companyId,
        department: department || 'unspecified',
        period,
        responseCount: (existing.responseCount || 0) + 1,
        sentimentScoreSum: (existing.sentimentScoreSum || 0) + sentimentScore,
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

    const historySnapshot = await firestore
      .collection(PULSE_RESPONSES_COLLECTION)
      .where('employeeId', '==', data.employeeId)
      .where('companyId', '==', data.companyId)
      .orderBy('submittedAt', 'desc')
      .limit(HISTORY_LOOKBACK + 1)
      .get()

    const history = historySnapshot.docs
      .filter((d) => d.id !== responseId)
      .slice(0, HISTORY_LOOKBACK)
      .map((d) => d.data())

    let result
    try {
      result = await analyzeWithClaude(data.answers, history)
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
