// Shared by storeReferenceCase.js and checkConsistency.js so both sides of a
// similarity comparison classify the accused's seniority the same way.
//
// referenceCases never stores a department name or job title - only a
// coarse tier - so the historical pattern this module builds can't be used
// to re-identify a specific past case even indirectly. harassment,
// retaliation, and toxicManagement all capture a structured role for the
// accused today (see routeCase.js's ACCUSED_PROFILE_FIELDS); only burnout
// falls back to 'unspecified', which only ever matches other 'unspecified'
// cases.
const ACCUSED_ROLE_FIELDS = {
  toxicManagement: 'toxic_manager_role',
  harassment: 'subject_role',
  retaliation: 'subject_role',
}

const MANAGER_KEYWORDS = ['manager', 'director', 'head', 'vp', 'chief', 'executive', 'president', 'ceo', 'coo', 'cfo']
const SENIOR_KEYWORDS = ['senior', 'lead', 'principal', 'supervisor']

// The canonical values subject_role/toxic_manager_role now submit (see
// harassment.js) are matched exactly, first - they already ARE the tier, so
// running them through the keyword heuristic below would be both pointless
// and a source of drift if a keyword list ever changed shape. The keyword
// path stays underneath as the legacy fallback for reference cases stored
// before the questionnaires moved off free text.
const CANONICAL_TIERS = new Set(['junior', 'senior', 'manager', 'unspecified'])

function classifyRoleText(roleText) {
  const text = String(roleText ?? '').trim().toLowerCase()
  if (CANONICAL_TIERS.has(text)) return text
  if (!text) return 'unspecified'
  if (MANAGER_KEYWORDS.some((keyword) => text.includes(keyword))) return 'manager'
  if (SENIOR_KEYWORDS.some((keyword) => text.includes(keyword))) return 'senior'
  // An unrecognised free-text role is left untiered rather than guessed as
  // 'junior' - a wrong tier actively distorts the reference pool's fairness
  // baseline, while 'unspecified' only ever matches other 'unspecified'
  // cases.
  return 'unspecified'
}

// category + responses: the same shape scoreCase.js and routeCase.js work
// with. Returns 'junior' | 'senior' | 'manager' | 'unspecified'.
function deriveDepartmentTier(category, responses) {
  const fieldId = ACCUSED_ROLE_FIELDS[category]
  if (!fieldId || !Array.isArray(responses)) return 'unspecified'

  const role = responses.find((response) => response.questionId === fieldId)?.value
  return classifyRoleText(role)
}

// classifyRoleText is exported so functions/src/patterns/ can derive the same
// junior/senior/manager tier from a role string without a second copy of the
// keyword lists - one classifier, two callers. The ACCUSED_ROLE_FIELDS map
// above is deliberately NOT shared: it is module 10's answer to "which
// questionnaire field names the accused's role", scoped to the reference pool
// checkConsistency.js compares against, and widening it here re-tiers that
// pool on its own timeline, not whenever routeCase.js's or
// subjectSignature.js's field maps change. Pattern detection keeps its own
// field map (see patterns/subjectSignature.js) for exactly that reason.
module.exports = { deriveDepartmentTier, classifyRoleText }
