// Question definitions for the burnout intake questionnaire. The free-text
// field below is marked `triggersCrisisCheck: true` so the intake form
// knows to route its content through the crisis-language detector - the
// actual detection and bypass logic lives in module 6, not here.
const burnoutQuestions = [
  {
    id: 'burnout_duration',
    text: 'How long have you been feeling this way?',
    type: 'select',
    options: [
      { value: 'weeks', label: 'A few weeks', severityWeight: 1 },
      { value: 'months', label: 'A couple of months', severityWeight: 2 },
      { value: 'over_6_months', label: 'Over 6 months', severityWeight: 3 },
      { value: 'over_a_year', label: 'Over a year', severityWeight: 4 },
    ],
    severityWeight: null,
  },
  {
    id: 'burnout_symptoms',
    text: 'Which of these have you been experiencing?',
    type: 'multiselect',
    options: [
      { value: 'exhaustion', label: 'Persistent exhaustion', severityWeight: 2 },
      { value: 'cynicism', label: 'Cynicism or detachment from work', severityWeight: 2 },
      { value: 'reduced_efficacy', label: 'Feeling ineffective or unaccomplished', severityWeight: 2 },
      { value: 'sleep_issues', label: 'Sleep problems', severityWeight: 2 },
      { value: 'physical_symptoms', label: 'Physical symptoms (headaches, illness)', severityWeight: 2 },
      { value: 'concentration', label: 'Difficulty concentrating', severityWeight: 2 },
    ],
    severityWeight: null,
  },
  {
    id: 'burnout_workload',
    text: 'How would you describe your current workload?',
    type: 'select',
    options: [
      { value: 'manageable', label: 'Manageable', severityWeight: 0 },
      { value: 'heavy', label: 'Heavy but doable', severityWeight: 1 },
      { value: 'excessive', label: 'Excessive', severityWeight: 2 },
      { value: 'unsustainable', label: 'Unsustainable', severityWeight: 3 },
    ],
    severityWeight: null,
  },
  {
    id: 'burnout_support',
    text: 'Do you feel supported by your manager and team?',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes', severityWeight: 0 },
      { value: 'somewhat', label: 'Somewhat', severityWeight: 1 },
      { value: 'no', label: 'No', severityWeight: 2 },
    ],
    severityWeight: null,
  },
  {
    id: 'burnout_impact',
    text: 'How much is this affecting your day-to-day life?',
    type: 'scale',
    options: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Severely' },
    severityWeight: 1,
  },
  {
    id: 'burnout_details',
    text: "Tell us more about how you've been doing, in your own words.",
    type: 'text',
    options: null,
    severityWeight: null,
    triggersCrisisCheck: true,
    optional: true,
  },
  {
    id: 'reporter_department',
    text: 'What department do you work in? (Optional - helps us spot company-wide trends, never shown to anyone individually.)',
    type: 'select',
    options: null,
    // Resolved at render time from companies/{companyId}.departments, same
    // pattern harassment.js's subject_department uses (see
    // QuestionnaireForm.jsx). Unlike that field, this one describes the
    // REPORTER, not a person the report is about - burnout has no subject
    // party (functions/src/patterns/subjectSignature.js). It feeds a
    // separate, weaker signal (functions/src/patterns/detectBurnoutTrends.js:
    // department-level report volume) that must never be joined back to
    // subjectDepartment/subjectSignatureHash.
    dynamicOptions: 'companyDepartments',
    severityWeight: null,
    optional: true,
  },
]

export default burnoutQuestions
