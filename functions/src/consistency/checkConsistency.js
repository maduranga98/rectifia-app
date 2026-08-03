const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { deriveDepartmentTier } = require('./departmentTier')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const REFERENCE_CASES_COLLECTION = 'referenceCases'

const DEFAULT_SEVERITY_BAND = 15
const MIN_REFERENCE_CASES = 5

// A controlled vocabulary, not free text - proposedAction and actionTaken
// are expected to be one of these keys so "harsher" vs. "lenient" can be
// read off a fixed escalation ladder rather than guessed at from strings.
// An action outside this list can still be compared for equality, but
// never gets a direction - see below.
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

function normalizeAction(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_')
}

function actionRank(value) {
  const rank = ACTION_SEVERITY_RANK[normalizeAction(value)]
  return typeof rank === 'number' ? rank : null
}

function severityWithinBand(a, b, band) {
  return Math.abs(a - b) <= band
}

// The single most common actionTaken among the matched reference cases.
// Ties resolve to whichever action was seen first - with only
// MIN_REFERENCE_CASES or more cases to draw from, an exact tie is rare
// enough not to warrant a tie-breaking policy of its own.
function mostCommonAction(actions) {
  const counts = new Map()
  for (const action of actions) {
    const key = normalizeAction(action)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let best = null
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key
      bestCount = count
    }
  }
  return best
}

// Only equality filters (companyId, category, department tier) plus an
// in-memory band filter on severityScore - Firestore doesn't need a
// composite index for equality-only queries, and the severity band is a
// configurable window, not something a range query index should be built
// around.
async function findSimilarReferenceCases(firestore, { companyId, category, departmentTier, severityScore, severityBand }) {
  const snapshot = await firestore
    .collection(REFERENCE_CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('category', '==', category)
    .where('department', '==', departmentTier)
    .get()

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((ref) => typeof ref.severityScore === 'number' && severityWithinBand(ref.severityScore, severityScore, severityBand))
}

// Fires when a Case Handler proposes an action on a case (a new or changed
// `proposedAction` field), before it's finalized. Writes its result back
// onto the case as `consistencyCheck` for a human to read - this module
// never suggests what the action should be, only whether it deviates from
// this company's own historical pattern for similar cases, and it flags
// deviation in both directions equally.
//
// This only ever compares against this company's own referenceCases
// (companyId is one of the match keys) - no cross-company benchmark pool
// exists here; that's a separate, later module.
exports.checkConsistency = onDocumentUpdated(`${CASES_COLLECTION}/{caseId}`, async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const caseId = event.params.caseId

  const newlyProposed = Boolean(after.proposedAction) && after.proposedAction !== before.proposedAction
  if (!newlyProposed) return

  if (!after.companyId || !after.category || typeof after.severityScore !== 'number') {
    logger.error('checkConsistency: case missing companyId/category/severityScore, skipping', { caseId })
    return
  }

  const firestore = admin.firestore()
  const severityBand = Number.isFinite(after.consistencyBandOverride) ? after.consistencyBandOverride : DEFAULT_SEVERITY_BAND
  const departmentTier = deriveDepartmentTier(after.category, after.responses)

  const referenceCases = await findSimilarReferenceCases(firestore, {
    companyId: after.companyId,
    category: after.category,
    departmentTier,
    severityScore: after.severityScore,
    severityBand,
  })

  const checkedAt = admin.firestore.FieldValue.serverTimestamp()

  if (referenceCases.length < MIN_REFERENCE_CASES) {
    await event.data.after.ref.update({
      consistencyCheck: {
        status: 'insufficient_data',
        similarCaseCount: referenceCases.length,
        checkedAt,
      },
    })
    return
  }

  const typicalAction = mostCommonAction(referenceCases.map((ref) => ref.actionTaken))
  const proposedRank = actionRank(after.proposedAction)
  const typicalRank = actionRank(typicalAction)

  if (proposedRank === null || typicalRank === null || proposedRank === typicalRank) {
    await event.data.after.ref.update({
      consistencyCheck: {
        status: proposedRank !== null && proposedRank === typicalRank ? 'consistent' : 'unrankable',
        similarCaseCount: referenceCases.length,
        typicalAction,
        checkedAt,
      },
    })
    return
  }

  const direction = proposedRank > typicalRank ? 'harsher' : 'lenient'

  await event.data.after.ref.update({
    consistencyCheck: {
      status: 'flagged',
      flag: {
        message: `${referenceCases.length} similar cases found, typical action was ${typicalAction}, proposed action is ${normalizeAction(after.proposedAction)}`,
        direction,
      },
      similarCaseCount: referenceCases.length,
      typicalAction,
      checkedAt,
    },
  })
})
