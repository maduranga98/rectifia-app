const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { MIN_POPULATION_FLOOR, buildPopulationIndex } = require('./suppressionRules')
const { resolveFlag } = require('../utils/featureFlags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'
const CASE_METADATA_COLLECTION = 'caseMetadata'
const BURNOUT_TREND_SIGNALS_COLLECTION = 'burnoutTrendSignals'
const BURNOUT_TREND_SUMMARIES_COLLECTION = 'burnoutTrendSummaries'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WINDOW_DAYS = 180
const DEFAULT_MIN_CASE_COUNT = 3

// Firestore caps a batch at 500 writes.
const BATCH_SIZE = 400

// Own config, own field, at companies/{companyId}.burnoutTrendDetection -
// deliberately not shared with patternDetection's config object even though
// the shape is identical, because a company can reasonably want one signal
// type on and the other off (see the feature flag check in the scheduler
// below) and a shared config object would let a change meant for one leak
// into the other. Same clamp-only-upward reasoning as detectPatterns.js's
// readPatternConfig: minCaseCount cannot go below 2, minPopulation cannot go
// below the shared privacy floor, and the field is not in firestore.rules'
// companyAdminEditableFields allowlist, so none of this is client-writable.
function readBurnoutTrendConfig(companyData) {
  const config = companyData?.burnoutTrendDetection ?? {}
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

// Every burnout case in the window with a reporter department, regardless of
// whether it ever closes - the same "read the always-current mirror, not the
// closed-case pool" reasoning detectPatterns.js's loadWindowedCases uses, so
// a cluster forming right now is visible immediately rather than only once
// every case in it has resolved.
async function loadWindowedBurnoutCases(firestore, companyId, windowStartMs) {
  const snapshot = await firestore
    .collection(CASE_METADATA_COLLECTION)
    .where('companyId', '==', companyId)
    .where('category', '==', 'burnout')
    .get()

  const rows = []
  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (!data.reporterDepartment) continue

    const reportedAtMs = toMillis(data.createdAt)
    if (reportedAtMs === null || reportedAtMs < windowStartMs) continue

    rows.push({ caseId: doc.id, department: data.reporterDepartment, reportedAtMs })
  }
  return rows
}

function groupByDepartment(rows) {
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.department)) {
      groups.set(row.department, { department: row.department, caseIds: new Set(), firstMs: row.reportedAtMs, lastMs: row.reportedAtMs })
    }
    const group = groups.get(row.department)
    group.caseIds.add(row.caseId)
    group.firstMs = Math.min(group.firstMs, row.reportedAtMs)
    group.lastMs = Math.max(group.lastMs, row.reportedAtMs)
  }
  return groups
}

// Department headcount, summed across every role tier. Tier is meaningless
// here - a burnout signal is about a team's report volume, not about
// clustering conduct at a role level - so this deliberately flattens the
// tiered index buildPopulationIndex() returns rather than adding a second
// population-counting function that would need to be kept in sync with it.
function departmentHeadcount(populationIndex, department) {
  const tiers = populationIndex.get(department)
  if (!tiers) return 0
  let total = 0
  for (const count of tiers.values()) total += count
  return total
}

async function recomputeCompanyBurnoutTrends(firestore, companyDoc, nowMs) {
  const companyId = companyDoc.id
  const { windowDays, minCaseCount, minPopulation } = readBurnoutTrendConfig(companyDoc.data())
  const windowStartMs = nowMs - windowDays * DAY_MS
  const computedAt = admin.firestore.Timestamp.fromMillis(nowMs)

  const [rows, employeeSnapshot] = await Promise.all([
    loadWindowedBurnoutCases(firestore, companyId, windowStartMs),
    firestore.collection(COMPANIES_COLLECTION).doc(companyId).collection(EMPLOYEES_SUBCOLLECTION).get(),
  ])

  const populationIndex = buildPopulationIndex(employeeSnapshot.docs.map((doc) => doc.data()))
  const groups = groupByDepartment(rows)

  // The company-wide baseline this window's departments are compared
  // against: total burnout cases over total headcount across every
  // department the directory knows about. A department's own
  // caseCount/headcount ratio divided by this is rateVsCompanyAverage - what
  // lets a 3-case cluster in a 6-person team read differently from 3 cases
  // in a 200-person department, which raw caseCount alone cannot do.
  const totalCases = rows.length
  let totalPopulation = 0
  for (const tiers of populationIndex.values()) {
    for (const count of tiers.values()) totalPopulation += count
  }
  const companyAverageRate = totalPopulation > 0 ? totalCases / totalPopulation : null

  const signals = new Map()
  let suppressedCount = 0

  for (const [department, group] of groups) {
    if (group.caseIds.size < minCaseCount) continue

    const headcount = departmentHeadcount(populationIndex, department)
    if (headcount < minPopulation) {
      suppressedCount += 1
      continue
    }

    const departmentRate = group.caseIds.size / headcount
    const rateVsCompanyAverage = companyAverageRate && companyAverageRate > 0 ? departmentRate / companyAverageRate : null

    signals.set(`${companyId}_${department}`, {
      companyId,
      department,
      caseCount: group.caseIds.size,
      windowDays,
      rateVsCompanyAverage,
      firstReportedAt: admin.firestore.Timestamp.fromMillis(group.firstMs),
      lastReportedAt: admin.firestore.Timestamp.fromMillis(group.lastMs),
      computedAt,
    })
  }

  // Recomputed from scratch, never appended to - a trend expires as its
  // window rolls forward, same as patternSignals' recomputeCompanySignals.
  const existingSnapshot = await firestore
    .collection(BURNOUT_TREND_SIGNALS_COLLECTION)
    .where('companyId', '==', companyId)
    .get()

  const operations = []
  for (const doc of existingSnapshot.docs) {
    if (!signals.has(doc.id)) operations.push((batch) => batch.delete(doc.ref))
  }
  for (const [id, signal] of signals) {
    operations.push((batch) => batch.set(firestore.collection(BURNOUT_TREND_SIGNALS_COLLECTION).doc(id), signal))
  }

  operations.push((batch) =>
    batch.set(firestore.collection(BURNOUT_TREND_SUMMARIES_COLLECTION).doc(companyId), {
      companyId,
      windowDays,
      minCaseCount,
      minPopulation,
      signalCount: signals.size,
      suppressedCount,
      computedAt,
    })
  )

  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = firestore.batch()
    for (const operation of operations.slice(i, i + BATCH_SIZE)) operation(batch)
    await batch.commit()
  }

  return { signalCount: signals.size, suppressedCount }
}

// Runs daily, offset from detectPatterns.js's 02:00 run so the two don't
// contend over the same caseMetadata collection at once. Same discipline as
// detectPatterns.js: deterministic counting only, no model call, no
// real-time trigger on case submit - a single day's noise should not move a
// trend any more than it should move a pattern signal.
//
// Gated on its own flag, separate from patternDetection: a company may want
// subject-based clustering on and department-level burnout volume off, or
// the reverse, and conflating the two flags would take that choice away.
exports.detectBurnoutTrends = onSchedule('every day 02:15', async () => {
  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()
  const nowMs = Date.now()

  for (const companyDoc of companiesSnapshot.docs) {
    if (!resolveFlag(companyDoc.data(), 'burnoutTrendDetection')) continue
    try {
      const result = await recomputeCompanyBurnoutTrends(firestore, companyDoc, nowMs)
      logger.info('detectBurnoutTrends: recomputed', { companyId: companyDoc.id, ...result })
    } catch (error) {
      logger.error('detectBurnoutTrends: company failed', { companyId: companyDoc.id, error: error.message })
    }
  }
})

exports.readBurnoutTrendConfig = readBurnoutTrendConfig
exports.recomputeCompanyBurnoutTrends = recomputeCompanyBurnoutTrends
