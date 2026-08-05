// The canonical Pulse Check question set. This file is the single source of
// truth for it - the survey form no longer defines its own copy, and no
// company, no role (including Super Admin) can change what is here at runtime.
//
// WHY THESE ARE LOCKED
//
// Two numbers in this module are computed from these answers and nothing else:
//
//   - trendFlag, produced by comparing an employee's last four responses
//     (functions/src/intake/analyzePulseResponse.js), and
//   - averageSentiment, a department/period average gated behind the
//     k-anonymity floor in functions/src/intake/pulseThresholds.js.
//
// Both are only meaningful if every response being compared answered the same
// question. If a company could edit these, "declining" might mean the wording
// changed, and a department average might be averaging answers to two
// different questions - with no way, after the fact, to tell which. Locking
// the core set removes that failure mode outright rather than trying to detect
// it later.
//
// Companies extend the questionnaire through SUPPLEMENTARY questions instead
// (functions/src/pulse/questionSet.js). Those appear in the survey and feed
// theme extraction, and they never feed sentimentScore, trendFlag, or any
// aggregate.
//
// CHANGING THE CORE SET is a deliberate code change by Lumora: edit the array
// below AND bump CORE_VERSION. The bump is what lets every later comparison
// see that a wording change happened at that point rather than reading it as a
// change in mood.

// Bumped ONLY here, in code, never at runtime by anyone. Every published
// company question set records the CORE_VERSION it was frozen against.
const CORE_VERSION = 1

// The five-point scale every core (and supplementary) scale question uses.
// Shared so the server can validate a submitted scale value against the same
// range the form rendered - the client stopped being the definition of a valid
// answer in module 21.
const SCALE_LABELS = ['Not at all', 'Rarely', 'Somewhat', 'Mostly', 'Very much']
const SCALE_MIN = 1
const SCALE_MAX = SCALE_LABELS.length

const QUESTION_TYPES = ['scale', 'freeText']

// `order` is explicit rather than implied by array position so that a resolved
// question set (core + supplementary) can be sorted by one comparable field.
// Core always sorts before supplementary; see resolveQuestionSet.
const CORE_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'workload',
    text: 'How manageable has your workload felt this week?',
    type: 'scale',
    order: 1,
    scaleLabels: SCALE_LABELS,
  }),
  Object.freeze({
    id: 'support',
    text: 'How supported do you feel by your manager/team?',
    type: 'scale',
    order: 2,
    scaleLabels: SCALE_LABELS,
  }),
  Object.freeze({
    id: 'wellbeing',
    text: 'How would you describe your overall wellbeing right now?',
    type: 'scale',
    order: 3,
    scaleLabels: SCALE_LABELS,
  }),
  Object.freeze({
    id: 'comments',
    text: 'Anything else you want to share?',
    type: 'freeText',
    order: 4,
    scaleLabels: null,
  }),
])

const CORE_QUESTION_IDS = Object.freeze(CORE_QUESTIONS.map((q) => q.id))

function isCoreQuestionId(id) {
  return CORE_QUESTION_IDS.includes(id)
}

// The core questions as they appear inside a resolved question set: same
// fields, plus the tier marker every consumer keys off. Returned as a fresh
// array of fresh objects so a caller can sort or extend it without mutating
// the frozen source of truth above.
function coreQuestionsForSet() {
  return CORE_QUESTIONS.map((q) => ({ ...q, tier: 'core' }))
}

module.exports = {
  CORE_VERSION,
  CORE_QUESTIONS,
  CORE_QUESTION_IDS,
  QUESTION_TYPES,
  SCALE_LABELS,
  SCALE_MIN,
  SCALE_MAX,
  isCoreQuestionId,
  coreQuestionsForSet,
}
