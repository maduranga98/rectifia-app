const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')
const MODEL = 'claude-opus-5'

const MESSAGES_SUBCOLLECTION = 'messages'

const CHECKLIST_ITEM_TYPES = ['interview_question', 'document_request', 'contradiction_flag']
const CHECKLIST_ITEM_STATUSES = ['suggested', 'checked', 'edited', 'ignored']

const CHECKLIST_SCHEMA = {
  type: 'object',
  properties: {
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: CHECKLIST_ITEM_TYPES,
            description: 'What kind of checklist item this is.',
          },
          item: {
            type: 'string',
            description: 'The suggested action itself - a question to ask, a document to request, or the contradiction/gap observed.',
          },
          rationale: {
            type: 'string',
            description: "Why this matters to the investigation, grounded in this case's specifics. Never a conclusion about the complaint.",
          },
        },
        required: ['type', 'item', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['checklist'],
  additionalProperties: false,
}

// The constraint that matters most here: this is a planning aid, never a
// verdict. The prompt is written to keep the model from drifting into
// assessing credibility or recommending an outcome, the same way
// aiFollowUp.js's prompt keeps that module from advising the reporter.
const CHECKLIST_SYSTEM_PROMPT = `You help a Case Handler plan a workplace-incident investigation by generating a checklist of things to look into next.

You are given the case category, the reporter's structured questionnaire answers, and the full case thread so far (reporter messages, AI follow-up questions, investigator messages, and investigator manual log entries).

Produce a checklist. Every item must be exactly one of:
- "interview_question": a specific question to ask in an interview.
- "document_request": a specific document, record, or piece of evidence to request.
- "contradiction_flag": a specific contradiction or unexplained gap between statements already present in the thread (e.g. between the reporter's account and a witness's, or between two of the reporter's own messages).

Rules, no exceptions:
- Never state or imply whether the complaint is true, credible, or exaggerated. Never suggest what should happen to the accused, what the outcome should be, or whether the case should be pursued, closed, or escalated. You are planning what to look into, not deciding anything.
- Only raise a contradiction_flag item for a contradiction that is actually present in the thread text given to you - never speculate one into existence.
- Ground every interview_question and document_request in the specific facts of this case category and what has already been said; avoid generic boilerplate that would apply to any case.
- Each item's rationale should explain why it matters to the investigation, not what conclusion it points toward.
- Produce as many items as are genuinely useful; do not pad the list to hit a target size.`

function formatResponses(responses) {
  return responses
    .map((response) => {
      const value = Array.isArray(response.value)
        ? response.value.length > 0
          ? response.value.join(', ')
          : '(none selected)'
        : response.value === '' || response.value == null
          ? '(no answer)'
          : String(response.value)
      return `- ${response.questionId} (${response.type}): ${value}`
    })
    .join('\n')
}

function buildTranscript(messages) {
  if (messages.length === 0) return '(no messages yet)'
  return messages
    .map((message) => {
      const label = message.type === 'manual_log' ? `${message.sender} (manual log)` : message.sender
      return `[${label}] ${message.text}`
    })
    .join('\n')
}

async function generateChecklistWithClaude({ apiKey, category, responses, transcript }) {
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: CHECKLIST_SYSTEM_PROMPT,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: CHECKLIST_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Category: ${category}\n\nQuestionnaire responses:\n${formatResponses(responses)}\n\nCase thread so far:\n${transcript}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    return { checklist: [] }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return { checklist: [] }

  const parsed = JSON.parse(textBlock.text)
  return { checklist: Array.isArray(parsed.checklist) ? parsed.checklist : [] }
}

function serializeChecklistItem(entry) {
  return {
    ...entry,
    createdAt: typeof entry.createdAt?.toMillis === 'function' ? entry.createdAt.toMillis() : entry.createdAt,
  }
}

// Callable, invoked by the assigned Case Handler from
// InvestigationChecklist.jsx. Regenerating overwrites the previous
// suggestions - the checklist is a snapshot of "what to look into given
// what we know now", not something merged across runs, since the thread it
// was built from keeps growing.
exports.generateChecklist = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { caseId } = request.data || {}

  const firestore = admin.firestore()
  const { caseRef, snapshot: caseSnapshot } = await loadCaseForHandler(firestore, caseId, uid)

  const caseData = caseSnapshot.data()
  const { category, responses } = caseData
  if (!category || !Array.isArray(responses)) {
    throw new HttpsError('failed-precondition', 'Case has no questionnaire responses yet')
  }

  const messagesSnapshot = await caseRef.collection(MESSAGES_SUBCOLLECTION).orderBy('timestamp', 'asc').get()
  const transcript = buildTranscript(messagesSnapshot.docs.map((doc) => doc.data()))

  let result
  try {
    result = await generateChecklistWithClaude({
      apiKey: anthropicApiKey.value(),
      category,
      responses,
      transcript,
    })
  } catch (err) {
    logger.error('generateChecklist: generation failed', { caseId, error: err.message })
    throw new HttpsError('internal', 'Checklist generation failed')
  }

  const now = admin.firestore.Timestamp.now()
  const checklist = result.checklist.map((entry, index) => ({
    id: `${now.toMillis()}_${index}`,
    type: entry.type,
    item: entry.item,
    rationale: entry.rationale,
    status: 'suggested',
    createdAt: now,
  }))

  await caseRef.update({
    checklist,
    checklistGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
    checklistGeneratedBy: uid,
  })

  return { checklist: checklist.map(serializeChecklistItem) }
})

// Lets the Case Handler check an item off, edit its text, or ignore it.
// These are suggestions, never a mandatory workflow gate, so there is
// deliberately no "all items must be checked before X" enforcement anywhere
// in this module.
exports.updateChecklistItem = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, itemId, status, text } = request.data || {}
  if (!caseId || !itemId) {
    throw new HttpsError('invalid-argument', 'caseId and itemId are required')
  }
  if (!CHECKLIST_ITEM_STATUSES.includes(status)) {
    throw new HttpsError('invalid-argument', `status must be one of ${CHECKLIST_ITEM_STATUSES.join(', ')}`)
  }
  if (status === 'edited' && !text?.trim()) {
    throw new HttpsError('invalid-argument', 'text is required when marking an item as edited')
  }

  const firestore = admin.firestore()
  // Verify the authenticated caller is the assigned handler before mutating.
  const { caseRef } = await loadCaseForHandler(firestore, caseId, uid)

  const updatedChecklist = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(caseRef)
    if (!snapshot.exists) {
      throw new HttpsError('not-found', 'No such case')
    }

    const checklist = Array.isArray(snapshot.data().checklist) ? snapshot.data().checklist : []
    const index = checklist.findIndex((entry) => entry.id === itemId)
    if (index === -1) {
      throw new HttpsError('not-found', 'No such checklist item')
    }

    const updatedItem = { ...checklist[index], status }
    if (status === 'edited') {
      updatedItem.item = text.trim()
    }

    const next = [...checklist]
    next[index] = updatedItem
    tx.update(caseRef, { checklist: next })
    return next
  })

  return { checklist: updatedChecklist.map(serializeChecklistItem) }
})
