const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')
const { buildScoringPrompt } = require('./prompts/scoringPrompt')

if (!admin.apps.length) {
  admin.initializeApp()
}

// The API key never touches client-accessible code - it's a Cloud Functions
// secret, injected only into this function's execution environment.
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')

const MODEL = 'claude-opus-5'

const SCORING_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    severityScore: {
      type: 'integer',
      description: 'How severe the reported conduct is, on a 0-100 scale.',
    },
    evidenceScore: {
      type: 'integer',
      description: 'How well-substantiated the account is, on a 0-100 scale, independent of severityScore.',
    },
    crisisFlag: {
      type: 'boolean',
      description: 'True only if the account indicates an active safety crisis requiring immediate human attention.',
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation grounding both scores in the specific responses given.',
    },
  },
  required: ['severityScore', 'evidenceScore', 'crisisFlag', 'reasoning'],
  additionalProperties: false,
}

function clampScore(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(100, Math.max(0, Math.round(number)))
}

function determineQueuePriority(severityScore) {
  if (severityScore >= 70) return 'high'
  if (severityScore >= 40) return 'medium'
  return 'low'
}

async function scoreWithClaude(category, responses) {
  const { system, user } = buildScoringPrompt(category, responses)
  const client = new Anthropic({ apiKey: anthropicApiKey.value() })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCORING_OUTPUT_SCHEMA },
    },
    messages: [{ role: 'user', content: user }],
  })

  if (response.stop_reason === 'refusal') {
    return { refused: true, category: response.stop_details?.category ?? null }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) {
    throw new Error('Claude response contained no text content')
  }

  const parsed = JSON.parse(textBlock.text)
  return {
    refused: false,
    severityScore: clampScore(parsed.severityScore),
    evidenceScore: clampScore(parsed.evidenceScore),
    crisisFlag: parsed.crisisFlag === true,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  }
}

// Exported so aiFollowUp.js can re-run the same scoring call (original
// responses plus the thread transcript) to recalculate evidenceScore as the
// conversation develops, without duplicating the Claude call or schema.
exports.scoreWithClaude = scoreWithClaude

// Scores a newly created case in isolation and writes the result back to the
// same document. Triggered only by Firestore onCreate - there is no callable
// or HTTP entry point, so a client can never invoke scoring directly.
//
// If the AI flags a crisis, the high-priority flag is written immediately
// and normal queue-routing is skipped entirely, since module 7 checks
// crisisFlag before anything else. This module never writes case status -
// it only ever produces scores and a routing hint; closing or dismissing a
// case is not something the model output is allowed to trigger. Comparing
// this case's scores against others (bias/consistency checking) is module
// 10's job, not this one's.
exports.scoreCase = onDocumentCreated(
  { document: 'cases/{caseId}', secrets: [anthropicApiKey] },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const { category, responses } = snapshot.data()

    if (!category || !Array.isArray(responses) || responses.length === 0) {
      // The case document was created before a questionnaire was submitted
      // (e.g. by generateCaseAccess). Nothing to score yet.
      return
    }

    const caseId = event.params.caseId
    let result

    try {
      result = await scoreWithClaude(category, responses)
    } catch (err) {
      logger.error('scoreCase: scoring request failed', { caseId, error: err.message })
      throw err
    }

    if (result.refused) {
      logger.error('scoreCase: scoring request was refused', { caseId, category: result.category })
      return
    }

    const firestore = admin.firestore()
    const caseRef = firestore.collection('cases').doc(caseId)

    if (result.crisisFlag) {
      await caseRef.update({
        severityScore: result.severityScore,
        evidenceScore: result.evidenceScore,
        crisisFlag: true,
        reasoning: result.reasoning,
        priorityFlag: 'high',
        flaggedAt: admin.firestore.FieldValue.serverTimestamp(),
        scoredAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      return
    }

    await caseRef.update({
      severityScore: result.severityScore,
      evidenceScore: result.evidenceScore,
      crisisFlag: false,
      reasoning: result.reasoning,
      queuePriority: determineQueuePriority(result.severityScore),
      scoredAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
)
