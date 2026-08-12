// Question definitions for the discrimination intake questionnaire. This
// module only structures the questions - scoring and analysis happen in
// module 6.
//
// subject_department / subject_role mirror the identical field ids
// harassment.js and retaliation already use to describe the person a report
// is about - see harassment.js for the full rationale (closed-vocabulary
// selects, not free text, so routeCase.js's conflict-of-interest check,
// departmentTier.js and subjectSignature.js all keep working without
// category-specific handling).
//
// discrimination_basis is deliberately excluded from severity scoring: every
// option carries severityWeight: null. Which protected characteristic is
// involved is a compliance-mapping fact, not a measure of how bad the
// reported conduct is - two reports describing the same adverse action
// should score identically regardless of which characteristic is named, so
// only discrimination_form (the act itself) and discrimination_pattern
// (its duration) are allowed to carry weight.
const discriminationQuestions = [
  {
    id: 'discrimination_basis',
    text: 'Which protected characteristic(s) do you believe this is related to?',
    type: 'multiselect',
    options: [
      { value: 'race_ethnicity', label: 'Race or ethnicity', severityWeight: null },
      { value: 'gender_sex', label: 'Gender or sex', severityWeight: null },
      { value: 'age', label: 'Age', severityWeight: null },
      { value: 'disability', label: 'Disability', severityWeight: null },
      { value: 'religion', label: 'Religion', severityWeight: null },
      { value: 'national_origin', label: 'National origin', severityWeight: null },
      {
        value: 'sexual_orientation_gender_identity',
        label: 'Sexual orientation or gender identity',
        severityWeight: null,
      },
      {
        value: 'pregnancy_parental_status',
        label: 'Pregnancy or parental status',
        severityWeight: null,
      },
      { value: 'other', label: 'Other', severityWeight: null },
    ],
    severityWeight: null,
  },
  {
    id: 'discrimination_form',
    text: 'What form did this discrimination take?',
    type: 'multiselect',
    options: [
      { value: 'hiring_promotion', label: 'A hiring or promotion decision', severityWeight: 5 },
      { value: 'pay_compensation', label: 'A pay or compensation disparity', severityWeight: 5 },
      {
        value: 'termination_layoff',
        label: 'A termination or layoff selection',
        severityWeight: 5,
      },
      { value: 'performance_evaluation', label: 'Performance evaluation bias', severityWeight: 3 },
      {
        value: 'task_assignment',
        label: 'Differences in task or assignment given',
        severityWeight: 2,
      },
      {
        value: 'exclusion_opportunities',
        label: 'Exclusion from opportunities',
        severityWeight: 2,
      },
      {
        value: 'comments_jokes',
        label: 'Comments or jokes referencing a protected characteristic',
        severityWeight: 1,
      },
    ],
    severityWeight: null,
  },
  {
    id: 'discrimination_pattern',
    text: 'How would you describe the pattern?',
    type: 'select',
    options: [
      { value: 'single', label: 'A single instance', severityWeight: 1 },
      { value: 'pattern', label: 'A pattern over time', severityWeight: 3 },
      { value: 'ongoing', label: 'Ongoing / still happening', severityWeight: 4 },
    ],
    severityWeight: null,
  },
  {
    id: 'subject_department',
    text: 'What department does the involved person work in? (Optional)',
    type: 'select',
    options: null,
    // Resolved at render time from companies/{companyId}.departments -
    // QuestionnaireForm.jsx builds the option list, this definition stays
    // company-agnostic. The last option ("I'd rather not say") maps to a null
    // answer, same as leaving the question unanswered.
    dynamicOptions: 'companyDepartments',
    severityWeight: null,
    optional: true,
  },
  {
    id: 'subject_role',
    text: "What is the involved person's role or title? (Optional)",
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
    id: 'discrimination_comparators',
    text: 'Do you know of anyone in a similar situation who was treated differently?',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes', severityWeight: 1 },
      { value: 'no', label: 'No', severityWeight: 0 },
      { value: 'unsure', label: 'Not sure', severityWeight: 0 },
    ],
    severityWeight: null,
    optional: true,
  },
  {
    id: 'discrimination_documentation',
    text: 'Is there documentation of this (emails, review records, pay records)?',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes', severityWeight: 1 },
      { value: 'no', label: 'No', severityWeight: 0 },
      { value: 'unsure', label: 'Not sure', severityWeight: 0 },
    ],
    severityWeight: null,
    optional: true,
  },
  {
    id: 'discrimination_impact',
    text: 'How much has this affected your ability to work?',
    type: 'scale',
    options: { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Severely' },
    severityWeight: 1,
  },
  {
    id: 'discrimination_details',
    text: 'Describe what happened, in your own words.',
    type: 'text',
    options: null,
    severityWeight: null,
    optional: true,
  },
]

export default discriminationQuestions
