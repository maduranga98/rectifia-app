// Prompt template for askInThread.js - the handler-initiated counterpart to
// aiFollowUp.js's reactive follow-up. The key difference from that prompt:
// aiFollowUp decides ON ITS OWN whether a gap is worth asking about, from
// evidenceScore and the transcript alone. Here the Case Handler has already
// decided what they want to ask about (`intent`) - Claude's job is only to
// phrase that as one well-grounded, reporter-facing question, not to pick a
// different topic it thinks is more important.
const { formatPolicyContext } = require('./scoringPrompt')

const ASK_IN_THREAD_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        "A single reporter-facing follow-up question, grounded in the Case Handler's stated intent and the existing case thread.",
    },
  },
  required: ['question'],
  additionalProperties: false,
}

// Same one-job constraint as aiFollowUp.js's FOLLOW_UP_SYSTEM_PROMPT and
// generateChecklist.js's CHECKLIST_SYSTEM_PROMPT: never drift into advising
// the reporter, implying a conclusion, or suggesting an outcome. The
// additional constraint here is that the model does not choose the topic -
// the Case Handler already did, via `intent` - so a request to phrase
// something outside what a neutral information-gathering question can ask
// (e.g. an intent that itself implies a conclusion) must be reworded into a
// neutral question, never answered by inventing a leading one.
const ASK_IN_THREAD_SYSTEM_PROMPT = `You help a Case Handler draft a single follow-up question to send to the reporter in an ongoing workplace-incident case thread.

You are given the case category, the reporter's structured questionnaire responses, the full case thread so far (reporter messages, AI follow-up questions, investigator messages, and investigator manual log entries), and the Case Handler's stated intent - what they want to ask about and why.

Rules, no exceptions:
- Draft exactly one question, grounded in the Case Handler's intent. The intent tells you what to ask about; your job is to phrase it well as a neutral, reporter-facing question, not to decide on a different topic or to add a second question.
- Ask only for more information: specifics, dates, documentation, witnesses, what was said or done. Never ask a leading question.
- Never suggest, state, or imply a conclusion, an outcome, what the company should do, or what the reporter should do next. If the intent itself implies a conclusion, phrase only the neutral information-gathering question buried inside it - never carry the implication into the question.
- Ground the phrasing in what has actually been said in the thread and questionnaire so far. Never introduce a fact, assumption, or accusation the record does not support.
- Write as if addressing the reporter directly and respectfully - this question may be sent to them exactly as drafted.`

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

// category/responses: the case's own category and questionnaire responses.
// transcript: the case thread rendered as "[sender] text" lines (see
// askInThread.js's buildTranscript, which matches generateChecklist.js's).
// intent: the Case Handler's free-text description of what they want to ask
// about - never shown to the reporter, only used to steer the draft.
// policyContext: optional string from retrievePolicyContext.getPolicyContext().
// Returns { system, user } ready to pass to the Messages API.
function buildAskInThreadPrompt({ category, responses, transcript, intent, policyContext }) {
  const user = `Category: ${category}\n\nQuestionnaire responses:\n${formatResponses(responses)}\n\nCase thread so far:\n${transcript}\n\nCase Handler's intent - what they want to ask about:\n${intent}`

  return {
    system: `${ASK_IN_THREAD_SYSTEM_PROMPT}${formatPolicyContext(policyContext)}`,
    user,
  }
}

module.exports = { ASK_IN_THREAD_SCHEMA, buildAskInThreadPrompt }
