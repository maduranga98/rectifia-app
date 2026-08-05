// Server-side mirror of the question TEXT (and, for choice questions, the
// option LABELS) defined in src/data/questionnaires/*.js. Nothing else about
// those files - scoring weights, crisis-check flags, option ordering for the
// intake form - is duplicated here; this exists purely so a compiled report's
// questionnaire section can print "What type of conduct are you reporting? ->
// Verbal" instead of "harassment_conduct_type -> verbal".
//
// It cannot be a `require()` of the real files: src/data/questionnaires/*.js
// are ES modules (`export default`) built for the Vite frontend bundle, and
// functions/ is a plain CommonJS Node runtime with no build step over it. A
// second copy of the id/text pairs is the smallest thing that bridges that
// gap without dragging a bundler into Cloud Functions. If a question's wording
// changes in src/data/questionnaires/, this file has to be updated to match -
// there is no automatic link between the two.
const QUESTION_TEXT = {
  harassment: {
    harassment_conduct_type: 'What type of conduct are you reporting?',
    harassment_frequency: 'How often has this happened?',
    harassment_power_dynamic: "What is the involved person's relationship to you?",
    subject_department: 'What department does the involved person work in? (Optional)',
    subject_role: "What is the involved person's role or title? (Optional - no names, please.)",
    harassment_witnesses: 'Were there any witnesses?',
    harassment_impact: 'How much has this affected your ability to work?',
    harassment_details: 'Describe what happened, in your own words.',
  },
  toxicManagement: {
    toxic_manager_department: 'What department does the involved manager work in?',
    toxic_manager_role: "What is the involved manager's role or title? (No names, please.)",
    toxic_manager_relationship: 'Is this manager your direct manager?',
    toxic_behaviors: 'Which behaviors have you experienced or witnessed?',
    toxic_frequency: 'How often does this behavior occur?',
    toxic_team_impact: 'How many people on the team do you believe are affected?',
    toxic_impact: 'How much has this affected your wellbeing at work?',
    toxic_details: 'Describe what happened, in your own words.',
  },
  retaliation: {
    retaliation_original_complaint_type: 'What did you originally report or oppose?',
    retaliation_original_complaint_timeframe: 'Approximately when did you make that original complaint?',
    retaliation_action_type: 'What happened to you afterward that you believe was retaliation?',
    retaliation_action_timeframe: 'Approximately when did this retaliatory action happen?',
    retaliation_actor_relationship: 'Who took the retaliatory action?',
    subject_department: 'What department does the person who took that action work in? (Optional)',
    subject_role: "What is that person's role or title? (Optional - no names, please.)",
    retaliation_details: 'Describe what happened, in your own words.',
  },
  burnout: {
    burnout_duration: 'How long have you been feeling this way?',
    burnout_symptoms: 'Which of these have you been experiencing?',
    burnout_workload: 'How would you describe your current workload?',
    burnout_support: 'Do you feel supported by your manager and team?',
    burnout_impact: 'How much is this affecting your day-to-day life?',
    burnout_details: "Tell us more about how you've been doing, in your own words.",
  },
}

// Option value -> label, for the select/multiselect questions only. A `text`
// or `scale` question has no fixed option set, so a response to one is
// printed as its raw value/number rather than looked up here.
const OPTION_LABELS = {
  harassment: {
    harassment_conduct_type: {
      verbal: 'Verbal (comments, jokes, slurs)',
      written: 'Written (messages, emails, posts)',
      physical: 'Physical (unwanted contact or gestures)',
      visual: 'Visual (images or materials displayed)',
      exclusion: 'Exclusion or isolation',
      other: 'Other',
    },
    harassment_frequency: {
      once: 'A single incident',
      occasional: 'A few times',
      repeated: 'Repeatedly over weeks',
      ongoing: 'Ongoing / still happening',
    },
    harassment_power_dynamic: {
      direct_manager: 'My direct manager',
      senior_leader: 'A senior leader (not my direct manager)',
      peer: 'A peer or colleague',
      report: 'Someone who reports to me',
      external: 'A client, vendor, or other external party',
    },
    harassment_witnesses: { yes: 'Yes', no: 'No', unsure: 'Not sure' },
  },
  toxicManagement: {
    toxic_manager_relationship: {
      direct: 'Yes, my direct manager',
      skip_level: "No, but they're above my direct manager",
      other_team: 'No, they manage a different team',
    },
    toxic_behaviors: {
      public_humiliation: 'Public humiliation or belittling',
      unreasonable_demands: 'Unreasonable demands or deadlines',
      credit_theft: "Taking credit for others' work",
      favoritism: 'Favoritism or unfair treatment',
      micromanagement: 'Excessive micromanagement',
      threats: 'Threats about job security',
      yelling: 'Yelling or aggressive outbursts',
    },
    toxic_frequency: {
      rare: 'Rarely',
      monthly: 'A few times a month',
      weekly: 'Weekly',
      daily: 'Almost daily',
    },
    toxic_team_impact: {
      just_me: 'Just me',
      a_few: 'A few of us',
      most: 'Most of the team',
    },
  },
  retaliation: {
    retaliation_original_complaint_type: {
      harassment_report: 'A harassment report',
      toxic_management_report: 'A toxic management report',
      safety_concern: 'A safety concern',
      legal_compliance_concern: 'A legal or compliance concern',
      supported_colleague: "Supported a colleague's complaint",
      other: 'Other',
    },
    retaliation_original_complaint_timeframe: {
      within_week: 'Within the last week',
      within_month: 'Within the last month',
      within_3_months: '1-3 months ago',
      within_6_months: '3-6 months ago',
      over_6_months: 'More than 6 months ago',
    },
    retaliation_action_type: {
      demotion: 'Demotion or loss of responsibilities',
      pay_cut: 'Pay cut or withheld raise/bonus',
      termination: 'Termination or threat of termination',
      negative_review: 'Sudden negative performance review',
      exclusion: 'Exclusion from meetings or projects',
      schedule_change: 'Unfavorable schedule or assignment change',
      hostility: 'Increased hostility or scrutiny',
      other: 'Other',
    },
    retaliation_action_timeframe: {
      within_week: 'Within the last week',
      within_month: 'Within the last month',
      within_3_months: '1-3 months ago',
      within_6_months: '3-6 months ago',
      over_6_months: 'More than 6 months ago',
    },
    retaliation_actor_relationship: {
      same_person: 'The person I originally reported',
      their_manager: "That person's manager",
      different_person: 'Someone else entirely',
      unsure: 'Not sure',
    },
  },
  burnout: {
    burnout_duration: {
      weeks: 'A few weeks',
      months: 'A couple of months',
      over_6_months: 'Over 6 months',
      over_a_year: 'Over a year',
    },
    burnout_symptoms: {
      exhaustion: 'Persistent exhaustion',
      cynicism: 'Cynicism or detachment from work',
      reduced_efficacy: 'Feeling ineffective or unaccomplished',
      sleep_issues: 'Sleep problems',
      physical_symptoms: 'Physical symptoms (headaches, illness)',
      concentration: 'Difficulty concentrating',
    },
    burnout_workload: {
      manageable: 'Manageable',
      heavy: 'Heavy but doable',
      excessive: 'Excessive',
      unsustainable: 'Unsustainable',
    },
    burnout_support: { yes: 'Yes', somewhat: 'Somewhat', no: 'No' },
  },
}

function resolveQuestionText(category, questionId) {
  return QUESTION_TEXT[category]?.[questionId] ?? questionId
}

function resolveOptionLabel(category, questionId, value) {
  return OPTION_LABELS[category]?.[questionId]?.[value] ?? value
}

// Resolves one raw { questionId, type, value, ... } response (the shape
// QuestionnaireForm.jsx / submitCase.js produce) into a printable
// { questionId, questionText, type, answer } row. `answer` is always a
// string: a scale or free-text value is shown as-is, a select value is
// resolved to its option label, and a multiselect value is a comma-joined
// list of resolved labels. An unanswered field prints as '(no answer)' rather
// than being silently blank, so a reader can tell "skipped" from "missing".
function resolveResponse(category, response) {
  const questionId = response?.questionId ?? null
  const type = response?.type ?? null
  const value = response?.value

  let answer
  if (Array.isArray(value)) {
    answer = value.length > 0
      ? value.map((v) => resolveOptionLabel(category, questionId, v)).join(', ')
      : '(none selected)'
  } else if (value === '' || value === undefined || value === null) {
    answer = '(no answer)'
  } else if (type === 'select') {
    answer = String(resolveOptionLabel(category, questionId, value))
  } else {
    answer = String(value)
  }

  return {
    questionId,
    questionText: questionId ? resolveQuestionText(category, questionId) : 'Unknown question',
    type,
    answer,
  }
}

module.exports = { resolveQuestionText, resolveOptionLabel, resolveResponse }
