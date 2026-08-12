import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import harassmentQuestions from '../data/questionnaires/harassment'
import toxicManagementQuestions from '../data/questionnaires/toxicManagement'
import discriminationQuestions from '../data/questionnaires/discrimination'
import retaliationQuestions from '../data/questionnaires/retaliation'
import burnoutQuestions from '../data/questionnaires/burnout'

const getCaseForTriageCallable = httpsCallable(functions, 'getCaseForTriage')

// Same map QuestionnaireForm.jsx builds, from the same modules - the
// questionnaire definitions in src/data/questionnaires/ are the single
// source of truth for what each question actually asked, and this reads
// them rather than keeping a second copy of the wording.
const QUESTIONNAIRES = {
  harassment: harassmentQuestions,
  toxicManagement: toxicManagementQuestions,
  discrimination: discriminationQuestions,
  retaliation: retaliationQuestions,
  burnout: burnoutQuestions,
}

// A stored answer is an option `value` (or a list of them, or a scale
// number, or free text) - 'direct_manager', not "My direct manager". Triage
// is a judgement call about who should handle a report, so the modal has to
// show the reader what was asked and what was answered in words, not the
// ids module 6 scores against.
function labelForOption(question, value) {
  const match = Array.isArray(question?.options)
    ? question.options.find((option) => option.value === value)
    : null
  return match?.label ?? String(value)
}

function displayAnswer(question, response) {
  const { value } = response
  if (value === null || value === undefined || value === '') return '—'

  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map((v) => labelForOption(question, v)).join(', ')
  }

  if (response.type === 'scale' || question?.type === 'scale') {
    const scale = question?.options
    return scale ? `${value} of ${scale.max} (${scale.minLabel} - ${scale.maxLabel})` : String(value)
  }

  if (response.type === 'text' || question?.type === 'text') return String(value)

  return labelForOption(question, value)
}

// Joins the sanitized answers the callable returned to their question text.
// Questions are emitted in questionnaire order rather than storage order so
// the modal reads like the form the reporter filled in; an answer whose
// question is no longer in the definition (an older case, a renamed field)
// is kept at the end under its raw id rather than silently dropped - it is
// still something the reporter said.
export function joinResponsesToQuestions(category, responses = []) {
  const questions = QUESTIONNAIRES[category] ?? []
  const byId = new Map(responses.map((response) => [response.questionId, response]))

  const known = questions
    .filter((question) => byId.has(question.id))
    .map((question) => ({
      questionId: question.id,
      question: question.text,
      answer: displayAnswer(question, byId.get(question.id)),
      type: byId.get(question.id).type ?? question.type ?? null,
    }))

  const knownIds = new Set(questions.map((question) => question.id))
  const orphaned = responses
    .filter((response) => !knownIds.has(response.questionId))
    .map((response) => ({
      questionId: response.questionId,
      question: response.questionId,
      answer: displayAnswer(null, response),
      type: response.type ?? null,
    }))

  return [...known, ...orphaned]
}

// Reads one unassigned case for triage. cases/{caseId} is not client-
// readable at all (firestore.rules denies it to both of these roles, and
// rules cannot filter fields even if it didn't), so this goes through the
// getCaseForTriage callable, which runs with the Admin SDK and returns a
// hand-built allowlist: routing metadata, the compliance deadlines, and the
// questionnaire answers. Never the message thread, never a reporter
// identity field, and only while the case is still unassigned - the
// callable enforces all three and audits every call.
export async function getCaseForTriage(caseId) {
  if (!caseId) throw new Error('caseId is required')
  const result = await getCaseForTriageCallable({ caseId })
  const payload = result.data
  return {
    ...payload,
    // The raw ids stay on the payload; `answers` is the readable pairing the
    // modal renders.
    answers: joinResponsesToQuestions(payload.category, payload.responses),
  }
}
