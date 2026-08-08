// Question definitions for the toxic-management intake questionnaire. The
// involved manager is identified by department + role only, never by name -
// see module 10 for the anonymity rationale behind that choice. This module
// only structures the questions; scoring happens in module 6.
//
// Both fields are closed-vocabulary selects, not free text - see the matching
// comment in harassment.js for why: these are matching keys for the
// conflict-of-interest check, the Consistency Engine's tiering, and pattern
// detection, not display fields, and free text broke all three silently.
const toxicManagementQuestions = [
  {
    id: 'toxic_manager_department',
    text: 'What department does the involved manager work in? (Optional)',
    type: 'select',
    options: null,
    dynamicOptions: 'companyDepartments',
    severityWeight: null,
  },
  {
    id: 'toxic_manager_role',
    text: "What is the involved manager's role or title? (Optional)",
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
  },
  {
    id: 'toxic_manager_relationship',
    text: 'Is this manager your direct manager?',
    type: 'select',
    options: [
      { value: 'direct', label: 'Yes, my direct manager', severityWeight: 3 },
      { value: 'skip_level', label: "No, but they're above my direct manager", severityWeight: 3 },
      { value: 'other_team', label: 'No, they manage a different team', severityWeight: 2 },
    ],
    severityWeight: null,
  },
  {
    id: 'toxic_behaviors',
    text: 'Which behaviors have you experienced or witnessed?',
    type: 'multiselect',
    options: [
      { value: 'public_humiliation', label: 'Public humiliation or belittling', severityWeight: 4 },
      { value: 'unreasonable_demands', label: 'Unreasonable demands or deadlines', severityWeight: 2 },
      { value: 'credit_theft', label: "Taking credit for others' work", severityWeight: 2 },
      { value: 'favoritism', label: 'Favoritism or unfair treatment', severityWeight: 2 },
      { value: 'micromanagement', label: 'Excessive micromanagement', severityWeight: 1 },
      { value: 'threats', label: 'Threats about job security', severityWeight: 4 },
      { value: 'yelling', label: 'Yelling or aggressive outbursts', severityWeight: 3 },
    ],
    severityWeight: null,
  },
  {
    id: 'toxic_frequency',
    text: 'How often does this behavior occur?',
    type: 'select',
    options: [
      { value: 'rare', label: 'Rarely', severityWeight: 1 },
      { value: 'monthly', label: 'A few times a month', severityWeight: 2 },
      { value: 'weekly', label: 'Weekly', severityWeight: 3 },
      { value: 'daily', label: 'Almost daily', severityWeight: 4 },
    ],
    severityWeight: null,
  },
  {
    id: 'toxic_team_impact',
    text: 'How many people on the team do you believe are affected?',
    type: 'select',
    options: [
      { value: 'just_me', label: 'Just me', severityWeight: 1 },
      { value: 'a_few', label: 'A few of us', severityWeight: 2 },
      { value: 'most', label: 'Most of the team', severityWeight: 3 },
    ],
    severityWeight: null,
  },
  {
    id: 'toxic_impact',
    text: 'How much has this affected your wellbeing at work?',
    type: 'scale',
    options: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Severely' },
    severityWeight: 1,
  },
  {
    id: 'toxic_details',
    text: 'Describe what happened, in your own words.',
    type: 'text',
    options: null,
    severityWeight: null,
    optional: true,
  },
]

export default toxicManagementQuestions
