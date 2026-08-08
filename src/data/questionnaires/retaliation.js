// subject_department / subject_role are the same optional pair harassment.js
// asks and that toxicManagement.js has always asked about the involved
// manager: department and role, never a name. Here they describe whoever took
// the retaliatory action. Leaving them blank costs the reporter nothing - a
// case missing either one just never joins a pattern group (see
// functions/src/patterns/subjectSignature.js).
//
// Both are closed-vocabulary selects, not free text - see the matching
// comment in harassment.js for why: these are matching keys for the
// conflict-of-interest check, the Consistency Engine's tiering, and pattern
// detection, not display fields, and free text broke all three silently.
//
// Question definitions for the retaliation intake questionnaire. Both
// timeframe fields feed the temporal-correlation score module 6 computes -
// this module only collects the raw approximate timing, it does not compute
// any correlation or score itself.
const TIMEFRAME_OPTIONS = [
  { value: 'within_week', label: 'Within the last week', severityWeight: 4 },
  { value: 'within_month', label: 'Within the last month', severityWeight: 3 },
  { value: 'within_3_months', label: '1-3 months ago', severityWeight: 2 },
  { value: 'within_6_months', label: '3-6 months ago', severityWeight: 1 },
  { value: 'over_6_months', label: 'More than 6 months ago', severityWeight: 0 },
]

const retaliationQuestions = [
  {
    id: 'retaliation_original_complaint_type',
    text: 'What did you originally report or oppose?',
    type: 'select',
    options: [
      { value: 'harassment_report', label: 'A harassment report', severityWeight: 2 },
      { value: 'toxic_management_report', label: 'A toxic management report', severityWeight: 2 },
      { value: 'safety_concern', label: 'A safety concern', severityWeight: 2 },
      { value: 'legal_compliance_concern', label: 'A legal or compliance concern', severityWeight: 2 },
      { value: 'supported_colleague', label: "Supported a colleague's complaint", severityWeight: 2 },
      { value: 'other', label: 'Other', severityWeight: 1 },
    ],
    severityWeight: null,
  },
  {
    id: 'retaliation_original_complaint_timeframe',
    text: 'Approximately when did you make that original complaint?',
    type: 'select',
    options: TIMEFRAME_OPTIONS,
    severityWeight: null,
  },
  {
    id: 'retaliation_action_type',
    text: 'What happened to you afterward that you believe was retaliation?',
    type: 'multiselect',
    options: [
      { value: 'demotion', label: 'Demotion or loss of responsibilities', severityWeight: 4 },
      { value: 'pay_cut', label: 'Pay cut or withheld raise/bonus', severityWeight: 4 },
      { value: 'termination', label: 'Termination or threat of termination', severityWeight: 5 },
      { value: 'negative_review', label: 'Sudden negative performance review', severityWeight: 3 },
      { value: 'exclusion', label: 'Exclusion from meetings or projects', severityWeight: 2 },
      { value: 'schedule_change', label: 'Unfavorable schedule or assignment change', severityWeight: 2 },
      { value: 'hostility', label: 'Increased hostility or scrutiny', severityWeight: 2 },
      { value: 'other', label: 'Other', severityWeight: 1 },
    ],
    severityWeight: null,
  },
  {
    id: 'retaliation_action_timeframe',
    text: 'Approximately when did this retaliatory action happen?',
    type: 'select',
    options: TIMEFRAME_OPTIONS,
    severityWeight: null,
  },
  {
    id: 'retaliation_actor_relationship',
    text: 'Who took the retaliatory action?',
    type: 'select',
    options: [
      { value: 'same_person', label: 'The person I originally reported', severityWeight: 4 },
      { value: 'their_manager', label: "That person's manager", severityWeight: 3 },
      { value: 'different_person', label: 'Someone else entirely', severityWeight: 2 },
      { value: 'unsure', label: 'Not sure', severityWeight: 1 },
    ],
    severityWeight: null,
  },
  {
    id: 'subject_department',
    text: 'What department does the person who took that action work in? (Optional)',
    type: 'select',
    options: null,
    dynamicOptions: 'companyDepartments',
    severityWeight: null,
    optional: true,
  },
  {
    id: 'subject_role',
    text: "What is that person's role or title? (Optional)",
    type: 'select',
    options: [
      { value: 'junior', label: 'About the same level as me, or more junior', severityWeight: null },
      {
        value: 'senior',
        label: 'Senior to me, but not a manager (lead, supervisor, principal)',
        severityWeight: null,
      },
      { value: 'manager', label: 'A manager, director or executive', severityWeight: null },
      { value: 'unspecified', label: "I'd rather not say", severityWeight: null },
    ],
    severityWeight: null,
    optional: true,
  },
  {
    id: 'retaliation_details',
    text: 'Describe what happened, in your own words.',
    type: 'text',
    options: null,
    severityWeight: null,
    optional: true,
  },
]

export default retaliationQuestions
