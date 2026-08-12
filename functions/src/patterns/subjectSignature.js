const crypto = require('crypto')
const { classifyRoleText } = require('../consistency/departmentTier')

// Which questionnaire fields describe the person a report is ABOUT, per
// category. Every one of these is a department + a role - never a name, never
// free-text narrative, never anything about the reporter. That is the whole
// contract of this file: a signature is what is left of a case once you remove
// everything that could point at a person, and it is the only thing pattern
// detection is allowed to group on.
//
// burnout has no entry on purpose - there is no subject party in a burnout
// report, so there is nothing to cluster and nothing to derive. Adding one
// would mean inventing a subject that the questionnaire never asked about.
const SUBJECT_FIELDS = {
  toxicManagement: { department: 'toxic_manager_department', role: 'toxic_manager_role' },
  harassment: { department: 'subject_department', role: 'subject_role' },
  retaliation: { department: 'subject_department', role: 'subject_role' },
  discrimination: { department: 'subject_department', role: 'subject_role' },
}

// Department is free text on every questionnaire, so "Engineering", " eng "
// and "ENGINEERING" have to collapse to the same grouping key or a real
// cluster splits into three groups of one and nothing ever fires. The same
// normalization is applied to employee directory departments in
// suppressionRules.js, so a signature and its population count are always
// measured against the same key.
function normalizeDepartment(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function answerFor(responses, questionId) {
  if (!Array.isArray(responses)) return null
  const answer = responses.find((response) => response.questionId === questionId)?.value
  return typeof answer === 'string' ? answer : null
}

// Returns { companyId, department, roleTier, category } or null.
//
// null - not a partial signature - is returned whenever either half is
// missing or the role text can't be tiered. A signature with an unknown
// department or an 'unspecified' tier would group together every case whose
// reporter skipped an optional question, which is not a pattern, it is a
// bucket of unrelated reports. Both fields are optional on the questionnaires
// by design, so this is the common case, not an error.
function deriveSubjectSignature({ companyId, category, responses }) {
  const fields = SUBJECT_FIELDS[category]
  if (!fields || !companyId) return null

  const department = normalizeDepartment(answerFor(responses, fields.department))
  if (!department) return null

  const roleTier = classifyRoleText(answerFor(responses, fields.role))
  if (roleTier === 'unspecified') return null

  return { companyId, department, roleTier, category }
}

// A stable id for a signature group, used as the caseMetadata mirror field and
// as the patternSignals document id so a recomputed signal overwrites its
// predecessor rather than accumulating duplicates.
//
// This is a grouping key, not a privacy measure, and it is not treated as one
// anywhere: the department and tier it hashes are stored in the clear on the
// signal itself, because a signal that didn't say which department it was
// about would be useless to the person reading it. The privacy boundary is
// the population suppression in suppressionRules.js, not this hash.
function signatureHash({ companyId, department, roleTier, category }) {
  return crypto
    .createHash('sha256')
    .update([companyId, department, roleTier, category].join('|'))
    .digest('hex')
    .slice(0, 32)
}

// The cross-category variant drops `category` from the key: it is the same
// department + tier seen through more than one kind of report.
function departmentTierHash({ companyId, department, roleTier }) {
  return crypto
    .createHash('sha256')
    .update([companyId, department, roleTier].join('|'))
    .digest('hex')
    .slice(0, 32)
}

module.exports = {
  deriveSubjectSignature,
  signatureHash,
  departmentTierHash,
  normalizeDepartment,
}
