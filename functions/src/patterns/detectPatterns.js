const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { signatureHash, departmentTierHash } = require('./subjectSignature')
const {
  MIN_POPULATION_FLOOR,
  SUPPRESSED_NO_DIRECTORY_DATA,
  SUPPRESSED_POPULATION_BELOW_MINIMUM,
  buildPopulationIndex,
  evaluateSuppression,
  evaluateCrossCategorySuppression,
  redactToAllowedFields,
} = require('./suppressionRules')
const { resolveFlag } = require('../utils/featureFlags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'
const CASE_METADATA_COLLECTION = 'caseMetadata'
const PATTERN_SIGNALS_COLLECTION = 'patternSignals'
const PATTERN_SUMMARIES_COLLECTION = 'patternSignalSummaries'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 180
const DEFAULT_MIN_CASE_COUNT = 3

// Firestore caps a batch at 500 writes.
const BATCH_SIZE = 400

// Per-company overrides live at companies/{companyId}.patternDetection, so a
// company can widen its window or require more cases without a deploy. Two
// deliberate asymmetries:
//
// - minCaseCount clamps up from 2. A signal that fires on a single case is not
//   a pattern, it is a case with extra steps.
// - minPopulation clamps up from the floor in suppressionRules.js and can only
//   ever be raised. Config is not a way to make suppression looser.
//
// The field is not in firestore.rules' companyAdminEditableFields allowlist, so
// it is not client-writable at all today - changing it is an Admin SDK / Super
// Admin operation. That is intentional for a value whose lower bound is a
// privacy guarantee.
function readPatternConfig(companyData) {
  const config = companyData?.patternDetection ?? {}
  const windowDays = Number(config.windowDays)
  const minCaseCount = Number(config.minCaseCount)
  const minPopulation = Number(config.minPopulation)

  return {
    windowDays:
      Number.isFinite(windowDays) && windowDays >= 1 && windowDays <= 730
        ? Math.floor(windowDays)
        : DEFAULT_WINDOW_DAYS,
    minCaseCount:
      Number.isFinite(minCaseCount) && minCaseCount >= 2
        ? Math.floor(minCaseCount)
        : DEFAULT_MIN_CASE_COUNT,
    minPopulation: Math.max(
      MIN_POPULATION_FLOOR,
      Number.isFinite(minPopulation) ? Math.floor(minPopulation) : 0
    ),
  }
}

function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

// caseMetadata mirrors every case, open and closed alike - which is the reason
// this module reads it rather than referenceCases. referenceCases only ever
// receives a case at the moment it closes (storeReferenceCase.js), so a
// cluster that is forming right now, which is the only kind worth surfacing
// early, would be invisible in it until every case in the cluster was already
// resolved.
async function loadWindowedCases(firestore, companyId, windowStartMs) {
  const snapshot = await firestore
    .collection(CASE_METADATA_COLLECTION)
    .where('companyId', '==', companyId)
    .get()

  const rows = []
  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (!data.subjectSignatureHash || !data.subjectDepartment || !data.subjectRoleTier) continue

    const reportedAtMs = toMillis(data.createdAt)
    if (reportedAtMs === null || reportedAtMs < windowStartMs) continue

    rows.push({
      caseId: doc.id,
      signatureHash: data.subjectSignatureHash,
      department: data.subjectDepartment,
      roleTier: data.subjectRoleTier,
      category: data.category ?? null,
      assignedHandlerId: data.assignedHandlerId ?? null,
      reportedAtMs,
    })
  }
  return rows
}

function accumulate(groups, key, seed, row) {
  if (!groups.has(key)) groups.set(key, { ...seed, caseIds: new Set(), handlerIds: new Set(), categories: new Set(), firstMs: row.reportedAtMs, lastMs: row.reportedAtMs })
  const group = groups.get(key)
  group.caseIds.add(row.caseId)
  if (row.assignedHandlerId) group.handlerIds.add(row.assignedHandlerId)
  if (row.category) group.categories.add(row.category)
  group.firstMs = Math.min(group.firstMs, row.reportedAtMs)
  group.lastMs = Math.max(group.lastMs, row.reportedAtMs)
  return group
}

// Two groupings over the same rows. Same-category is the primary signal:
// several reports of the same kind about the same department and tier.
// Cross-category is the same department and tier reached across DIFFERENT
// kinds of report - deliberately computed and labelled separately because it
// is weaker evidence, and a reader who cannot tell the two apart will read a
// mixed group as if it were a repeated-conduct cluster.
function groupBySignature(companyId, rows) {
  const sameCategory = new Map()
  const crossCategory = new Map()

  for (const row of rows) {
    accumulate(sameCategory, row.signatureHash, { department: row.department, roleTier: row.roleTier, category: row.category }, row)
    accumulate(
      crossCategory,
      departmentTierHash({ companyId, department: row.department, roleTier: row.roleTier }),
      { department: row.department, roleTier: row.roleTier, category: null },
      row
    )
  }

  return { sameCategory, crossCategory }
}

function buildSignal({ companyId, group, signalType, windowDays, computedAt }) {
  return redactToAllowedFields({
    companyId,
    department: group.department,
    roleTier: group.roleTier,
    category: group.category,
    // Distinct case documents. It is NOT a count of distinct reporters and
    // cannot be: reports are anonymous by design, so one person filing four
    // times and four people filing once are indistinguishable here. The UI
    // says so in as many words - see PatternSignals.jsx.
    caseCount: group.caseIds.size,
    windowDays,
    firstReportedAt: admin.firestore.Timestamp.fromMillis(group.firstMs),
    lastReportedAt: admin.firestore.Timestamp.fromMillis(group.lastMs),
    signalType,
    caseIds: [...group.caseIds],
    handlerIds: [...group.handlerIds],
    computedAt,
  })
}

async function commitInChunks(firestore, operations) {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = firestore.batch()
    for (const operation of operations.slice(i, i + BATCH_SIZE)) operation(batch)
    await batch.commit()
  }
}

async function recomputeCompanySignals(firestore, companyDoc, nowMs) {
  const companyId = companyDoc.id
  const { windowDays, minCaseCount, minPopulation } = readPatternConfig(companyDoc.data())
  const windowStartMs = nowMs - windowDays * DAY_MS
  const computedAt = admin.firestore.Timestamp.fromMillis(nowMs)

  const [rows, employeeSnapshot] = await Promise.all([
    loadWindowedCases(firestore, companyId, windowStartMs),
    firestore.collection(COMPANIES_COLLECTION).doc(companyId).collection(EMPLOYEES_SUBCOLLECTION).get(),
  ])

  const populationIndex = buildPopulationIndex(employeeSnapshot.docs.map((doc) => doc.data()))
  const { sameCategory, crossCategory } = groupBySignature(companyId, rows)

  const signals = new Map()
  const suppressed = { [SUPPRESSED_POPULATION_BELOW_MINIMUM]: 0, [SUPPRESSED_NO_DIRECTORY_DATA]: 0 }

  const consider = (key, group, signalType, evaluate) => {
    if (group.caseIds.size < minCaseCount) return
    // A cross-category group whose cases are all one category is just the
    // same-category signal counted twice - it says nothing extra, so it is not
    // written at all rather than written as a duplicate of its sibling.
    if (signalType === 'cross_category' && group.categories.size < 2) return

    const verdict = evaluate({
      populationIndex,
      department: group.department,
      roleTier: group.roleTier,
      minPopulation,
    })
    if (verdict.suppressed) {
      suppressed[verdict.reason] += 1
      return
    }

    signals.set(`${companyId}_${signalType}_${key}`, buildSignal({ companyId, group, signalType, windowDays, computedAt }))
  }

  for (const [key, group] of sameCategory) consider(key, group, 'same_category', evaluateSuppression)
  for (const [key, group] of crossCategory) consider(key, group, 'cross_category', evaluateCrossCategorySuppression)

  // Recomputed from scratch, never appended to: every signal this company had
  // is compared against what this run produced, and anything not reproduced is
  // deleted. That is what lets a signal expire - once its oldest case falls out
  // of the rolling window and the group drops below the threshold, the document
  // goes away instead of standing as a permanent accusation about a department.
  const existingSnapshot = await firestore
    .collection(PATTERN_SIGNALS_COLLECTION)
    .where('companyId', '==', companyId)
    .get()

  const operations = []
  for (const doc of existingSnapshot.docs) {
    if (!signals.has(doc.id)) operations.push((batch) => batch.delete(doc.ref))
  }
  for (const [id, signal] of signals) {
    operations.push((batch) => batch.set(firestore.collection(PATTERN_SIGNALS_COLLECTION).doc(id), signal))
  }

  // The run summary is how "nothing appeared because it would not have been
  // safe to show it" reaches the dashboard. It carries counts and thresholds
  // only - no department, no tier, no category - because naming which group was
  // suppressed would leak precisely the small group the suppression exists to
  // protect.
  operations.push((batch) =>
    batch.set(firestore.collection(PATTERN_SUMMARIES_COLLECTION).doc(companyId), {
      companyId,
      windowDays,
      minCaseCount,
      minPopulation,
      signalCount: signals.size,
      suppressedCount: suppressed[SUPPRESSED_POPULATION_BELOW_MINIMUM] + suppressed[SUPPRESSED_NO_DIRECTORY_DATA],
      suppressedByPopulation: suppressed[SUPPRESSED_POPULATION_BELOW_MINIMUM],
      suppressedByMissingDirectory: suppressed[SUPPRESSED_NO_DIRECTORY_DATA],
      computedAt,
    })
  )

  await commitInChunks(firestore, operations)
  return { signalCount: signals.size, suppressedCount: suppressed[SUPPRESSED_POPULATION_BELOW_MINIMUM] + suppressed[SUPPRESSED_NO_DIRECTORY_DATA] }
}

// Runs daily and rebuilds every company's pattern signals from its own
// caseMetadata. Deterministic counting end to end - no model call anywhere in
// this module. Inference about who a cluster is "really" about is the specific
// risk here, so the code does not infer: it counts cases per signature, checks
// the population that signature points into, and writes the count or nothing.
//
// Nothing downstream is triggered by a signal firing. No routing change, no
// escalation, no notification - a signal is a row on two screens and that is
// all it is. Grouping is always scoped by companyId, so no signal ever spans
// two companies.
exports.detectPatterns = onSchedule('every day 02:00', async () => {
  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()
  const nowMs = Date.now()

  for (const companyDoc of companiesSnapshot.docs) {
    // A company with pattern detection turned off is skipped before any
    // counting work - its existing patternSignals are left exactly as they
    // are (they simply stop updating), not deleted.
    if (!resolveFlag(companyDoc.data(), 'patternDetection')) continue
    try {
      const result = await recomputeCompanySignals(firestore, companyDoc, nowMs)
      logger.info('detectPatterns: recomputed', { companyId: companyDoc.id, ...result })
    } catch (error) {
      // One company's bad data (an unreadable roster, a malformed config) must
      // not stop every other company's signals from being recomputed - and a
      // failed run that left stale signals in place is worse than a logged
      // error, so this is logged loudly rather than swallowed.
      logger.error('detectPatterns: company failed', { companyId: companyDoc.id, error: error.message })
    }
  }
})

// Exported for direct exercise of the counting/suppression pass without the
// scheduler wrapper around it.
exports.readPatternConfig = readPatternConfig
exports.recomputeCompanySignals = recomputeCompanySignals
