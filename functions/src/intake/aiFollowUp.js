const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')
const { scoreWithClaude } = require('./scoreCase')
const { notifyCrisisContact } = require('./routeCase')

if (!admin.apps.length) {
  admin.initializeApp()
}

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')
const MODEL = 'claude-opus-5'

const FOLLOW_UP_SCHEMA = {
  type: 'object',
  properties: {
    hasFollowUp: {
      type: 'boolean',
      description: 'True if there is a meaningful evidence gap worth asking about.',
    },
    question: {
      type: 'string',
      description: 'A single follow-up question asking for more information. Empty string if hasFollowUp is false.',
    },
  },
  required: ['hasFollowUp', 'question'],
  additionalProperties: false,
}

// The one-job constraint that matters most here: this prompt must never let
// the model drift into advising the reporter or hinting at an outcome. It
// only ever asks for more information.
const FOLLOW_UP_SYSTEM_PROMPT = `You help fill evidence gaps in a workplace-incident report by asking the reporter follow-up questions.

You are given the case category, the current evidence assessment, and the conversation so far.

Rules, no exceptions:
- Ask only for more information: specifics, dates, documentation, witnesses, what was said or done. Never ask a leading question.
- Never suggest a conclusion, an outcome, what the company should do, or what the reporter should do next. You are not an advisor - you exist only to fill gaps in the account.
- Never repeat a question that has already been asked and answered in the conversation.
- If the evidence is already reasonably well-substantiated, or a prior question already covers the remaining gap, set hasFollowUp to false and leave question empty. Do not ask a question just to ask one.
- Ask at most one question per turn.`

function buildTranscript(messages) {
  return messages
    .filter((message) => message.type !== 'manual_log')
    .map((message) => `[${message.sender}] ${message.text}`)
    .join('\n')
}

async function generateFollowUp({ apiKey, category, evidenceScore, reasoning, transcript }) {
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: FOLLOW_UP_SYSTEM_PROMPT,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: FOLLOW_UP_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Category: ${category}\nCurrent evidenceScore: ${evidenceScore}\nCurrent evidence assessment: ${reasoning}\n\nConversation so far:\n${transcript}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    return { hasFollowUp: false, question: '' }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return { hasFollowUp: false, question: '' }

  const parsed = JSON.parse(textBlock.text)
  return {
    hasFollowUp: parsed.hasFollowUp === true,
    question: typeof parsed.question === 'string' ? parsed.question.trim() : '',
  }
}

// Runs every time the reporter adds a new message to the case thread.
// Recalculates evidenceScore against the fuller picture (original
// questionnaire responses plus the thread so far, reusing scoreCase.js's
// scoring call directly so the two never drift apart), and - if a
// meaningful gap remains - asks one clarifying question back into the same
// thread. Investigator messages and manual log entries do not trigger this;
// only new information from the reporter does.
exports.aiFollowUp = onDocumentCreated(
  { document: 'cases/{caseId}/messages/{messageId}', secrets: [anthropicApiKey] },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return

    const message = snapshot.data()
    if (message.sender !== 'reporter') return

    const caseId = event.params.caseId
    const firestore = admin.firestore()
    const caseRef = firestore.collection('cases').doc(caseId)
    const caseSnapshot = await caseRef.get()
    if (!caseSnapshot.exists) return

    const caseData = caseSnapshot.data()
    const { category, responses } = caseData
    if (!category || !Array.isArray(responses)) return

    const messagesSnapshot = await caseRef.collection('messages').orderBy('timestamp', 'asc').get()
    const transcript = buildTranscript(messagesSnapshot.docs.map((doc) => doc.data()))

    const combinedResponses = [
      ...responses,
      {
        questionId: 'case_thread_transcript',
        type: 'text',
        value: transcript,
        severityWeight: null,
      },
    ]

    let result
    try {
      result = await scoreWithClaude(category, combinedResponses)
    } catch (err) {
      logger.error('aiFollowUp: rescoring failed', { caseId, error: err.message })
      return
    }

    if (result.refused) {
      logger.error('aiFollowUp: rescoring request was refused', { caseId })
      return
    }

    const update = {
      evidenceScore: result.evidenceScore,
      reasoning: result.reasoning,
      scoredAt: admin.firestore.FieldValue.serverTimestamp(),
    }

    const newlyInCrisis = result.crisisFlag === true && caseData.crisisFlag !== true
    if (newlyInCrisis) {
      update.crisisFlag = true
      update.crisisNotifiedAt = admin.firestore.FieldValue.serverTimestamp()
    }

    await caseRef.update(update)

    if (newlyInCrisis) {
      // A crisis surfacing mid-thread gets the same immediate,
      // routing-bypassing treatment as one caught at initial scoring.
      await notifyCrisisContact({
        companyId: caseData.companyId ?? null,
        caseId,
        category,
        severityScore: caseData.severityScore,
        evidenceScore: result.evidenceScore,
      })
      return
    }

    let followUp
    try {
      followUp = await generateFollowUp({
        apiKey: anthropicApiKey.value(),
        category,
        evidenceScore: result.evidenceScore,
        reasoning: result.reasoning,
        transcript,
      })
    } catch (err) {
      logger.error('aiFollowUp: follow-up generation failed', { caseId, error: err.message })
      return
    }

    if (followUp.hasFollowUp && followUp.question) {
      await caseRef.collection('messages').add({
        sender: 'ai',
        type: 'message',
        text: followUp.question,
        attachments: [],
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
  }
)
