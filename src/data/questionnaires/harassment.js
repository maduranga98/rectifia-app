// Question definitions for the harassment intake questionnaire. This module
// only structures the questions - scoring and analysis happen in module 6.
const harassmentQuestions = [
  {
    id: 'harassment_conduct_type',
    text: 'What type of conduct are you reporting?',
    type: 'multiselect',
    options: [
      { value: 'verbal', label: 'Verbal (comments, jokes, slurs)', severityWeight: 2 },
      { value: 'written', label: 'Written (messages, emails, posts)', severityWeight: 2 },
      { value: 'physical', label: 'Physical (unwanted contact or gestures)', severityWeight: 5 },
      { value: 'visual', label: 'Visual (images or materials displayed)', severityWeight: 2 },
      { value: 'exclusion', label: 'Exclusion or isolation', severityWeight: 1 },
      { value: 'other', label: 'Other', severityWeight: 1 },
    ],
    severityWeight: null,
  },
  {
    id: 'harassment_frequency',
    text: 'How often has this happened?',
    type: 'select',
    options: [
      { value: 'once', label: 'A single incident', severityWeight: 1 },
      { value: 'occasional', label: 'A few times', severityWeight: 2 },
      { value: 'repeated', label: 'Repeatedly over weeks', severityWeight: 3 },
      { value: 'ongoing', label: 'Ongoing / still happening', severityWeight: 4 },
    ],
    severityWeight: null,
  },
  {
    id: 'harassment_power_dynamic',
    text: "What is the involved person's relationship to you?",
    type: 'select',
    options: [
      { value: 'direct_manager', label: 'My direct manager', severityWeight: 4 },
      { value: 'senior_leader', label: 'A senior leader (not my direct manager)', severityWeight: 4 },
      { value: 'peer', label: 'A peer or colleague', severityWeight: 2 },
      { value: 'report', label: 'Someone who reports to me', severityWeight: 2 },
      { value: 'external', label: 'A client, vendor, or other external party', severityWeight: 2 },
    ],
    severityWeight: null,
  },
  {
    id: 'harassment_witnesses',
    text: 'Were there any witnesses?',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes', severityWeight: 1 },
      { value: 'no', label: 'No', severityWeight: 0 },
      { value: 'unsure', label: 'Not sure', severityWeight: 0 },
    ],
    severityWeight: null,
  },
  {
    id: 'harassment_impact',
    text: 'How much has this affected your ability to work?',
    type: 'scale',
    options: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Severely' },
    severityWeight: 1,
  },
  {
    id: 'harassment_details',
    text: 'Describe what happened, in your own words.',
    type: 'text',
    options: null,
    severityWeight: null,
  },
]

export default harassmentQuestions
