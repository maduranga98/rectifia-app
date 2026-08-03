// Shared by storeReferenceCase.js and checkConsistency.js so both sides of a
// similarity comparison classify the accused's seniority the same way.
//
// referenceCases never stores a department name or job title - only a
// coarse tier - so the historical pattern this module builds can't be used
// to re-identify a specific past case even indirectly. Only
// toxicManagement's questionnaire captures a structured role for the
// accused today (see routeCase.js's ACCUSED_PROFILE_FIELDS); every other
// category falls back to 'unspecified', which only ever matches other
// 'unspecified' cases.
const ACCUSED_ROLE_FIELDS = {
  toxicManagement: 'toxic_manager_role',
}

const MANAGER_KEYWORDS = ['manager', 'director', 'head', 'vp', 'chief', 'executive', 'president', 'ceo', 'coo', 'cfo']
const SENIOR_KEYWORDS = ['senior', 'lead', 'principal', 'supervisor']

function classifyRoleText(roleText) {
  const text = String(roleText ?? '').trim().toLowerCase()
  if (!text) return 'unspecified'
  if (MANAGER_KEYWORDS.some((keyword) => text.includes(keyword))) return 'manager'
  if (SENIOR_KEYWORDS.some((keyword) => text.includes(keyword))) return 'senior'
  return 'junior'
}

// category + responses: the same shape scoreCase.js and routeCase.js work
// with. Returns 'junior' | 'senior' | 'manager' | 'unspecified'.
function deriveDepartmentTier(category, responses) {
  const fieldId = ACCUSED_ROLE_FIELDS[category]
  if (!fieldId || !Array.isArray(responses)) return 'unspecified'

  const role = responses.find((response) => response.questionId === fieldId)?.value
  return classifyRoleText(role)
}

module.exports = { deriveDepartmentTier }
