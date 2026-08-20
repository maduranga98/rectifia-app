const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')
const { getPolicyContext } = require('../policy/retrievePolicyContext')
const { ASK_IN_THREAD_SCHEMA, buildAskInThreadPrompt } = require('./prompts/askInThreadPrompt')

if (!admin.apps.length) {
  admin.initializeApp()
}

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')
const MODEL = 'claude-haiku-4-5-20251001'

const MESSAGES_SUBCOLLECTION = 'messages'
const MAX_INTENT_LENGTH = 500

// Same transcript rendering as generateChecklist.js's buildTranscript, so a
// question drafted here is grounded in the identical view of the thread the
// checklist itself was generated from.
function buildTranscript(messages) {
  if (messages.length === 0) return '(no messages yet)'
  return messages
    .map((message) => {
      const label = message.type === 'manual_log' ? `${message.sender} (manual log)` : message.sender
      return `[${label}] ${message.text}`
    })
    .join('\n')
}

async function draftQuestionWithClaude({ apiKey, category, responses, transcript, intent, policyContext }) {
  const client = new Anthropic({ apiKey })
  const { system, user } = buildAskInThreadPrompt({ category, responses, transcript, intent, policyContext })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    output_config: {
      format: { type: 'json_schema', schema: ASK_IN_THREAD_SCHEMA },
    },
    messages: [{ role: 'user', content: user }],
  })

  if (response.stop_reason === 'refusal') {
    throw new HttpsError('internal', 'Question drafting was refused')
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) {
    throw new HttpsError('internal', 'Question drafting failed')
  }

  const parsed = JSON.parse(textBlock.text)
  const question = typeof parsed.question === 'string' ? parsed.question.trim() : ''
  if (!question) {
    throw new HttpsError('internal', 'Question drafting failed')
  }
  return question
}

// Handler-initiated counterpart to aiFollowUp.js's reactive, onDocumentCreated
// follow-up. That trigger only ever fires off a new reporter message and
// decides on its own whether a gap is worth asking about; this callable lets
// a Case Handler ask for a drafted question on demand, telling Claude what
// they want to ask about (`intent`) rather than leaving the "what" to the
// model - the handler decides what matters, Claude only phrases it.
//
// This never writes to the thread. The draft is returned as plain text for
// the handler to review, edit, and send through the existing
// postInvestigatorMessage/sendInvestigatorMessage path (see
// caseThreadService.js's sendInvestigatorMessage), so a question drafted here
// is indistinguishable in the audit trail from one the handler typed
// themselves - no new message `type` is introduced, and this callable has no
// write access to cases/{caseId}/messages at all.
exports.askInThread = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, intent } = request.data || {}

  if (!intent?.trim()) {
    throw new HttpsError('invalid-argument', 'intent is required')
  }
  if (intent.length > MAX_INTENT_LENGTH) {
    throw new HttpsError('invalid-argument', `intent must be ${MAX_INTENT_LENGTH} characters or fewer`)
  }

  const firestore = admin.firestore()
  // Same investigator-only, assigned-handler gate postInvestigatorMessage and
  // getCaseThreadForHandler use - a Case Handler may only invoke this on a
  // case actually assigned to them.
  const { caseRef, snapshot: caseSnapshot } = await loadCaseForHandler(firestore, caseId, uid, 'ask_in_thread')

  const caseData = caseSnapshot.data()
  const { category, responses } = caseData
  if (!category || !Array.isArray(responses)) {
    throw new HttpsError('failed-precondition', 'Case has no questionnaire responses yet')
  }

  const messagesSnapshot = await caseRef.collection(MESSAGES_SUBCOLLECTION).orderBy('timestamp', 'asc').get()
  const transcript = buildTranscript(messagesSnapshot.docs.map((doc) => doc.data()))

  // Same grounding every other AI call site in this module uses. Degrades to
  // empty when the company has uploaded no policy for this category.
  const { text: policyContext } = await getPolicyContext(caseData.companyId ?? null, category)

  let question
  try {
    question = await draftQuestionWithClaude({
      apiKey: anthropicApiKey.value(),
      category,
      responses,
      transcript,
      intent: intent.trim(),
      policyContext,
    })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error('askInThread: drafting failed', { caseId, error: err.message })
    throw new HttpsError('internal', 'Question drafting failed')
  }

  return { question }
})
