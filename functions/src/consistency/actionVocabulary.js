// Shared by checkConsistency.js and caseActions.js so both sides agree on
// what a valid proposed/final action is, and on the escalation ladder used
// to compare them. A controlled vocabulary, not free text - "harsher" vs.
// "lenient" only means something when both sides are drawn from this same
// fixed ranking.
const ACTION_SEVERITY_RANK = {
  no_action: 0,
  coaching: 1,
  verbal_warning: 2,
  written_warning: 3,
  performance_improvement_plan: 4,
  suspension: 5,
  demotion: 6,
  termination: 7,
}

const ACTION_TAKEN_OPTIONS = Object.keys(ACTION_SEVERITY_RANK)

function normalizeAction(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

function actionRank(value) {
  const rank = ACTION_SEVERITY_RANK[normalizeAction(value)]
  return typeof rank === 'number' ? rank : null
}

module.exports = { ACTION_SEVERITY_RANK, ACTION_TAKEN_OPTIONS, normalizeAction, actionRank }
