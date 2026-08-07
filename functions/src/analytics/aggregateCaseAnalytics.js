const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { getStrictestRule } = require('../compliance/jurisdictionRules')
const { CATEGORIES } = require('../benchmark/benchmarkThresholds')
const { deriveDepartmentTier } = require('../consistency/departmentTier')
const { normalizeAction, actionRank } = require('../consistency/actionVocabulary')
const { mostCommonAction, MIN_REFERENCE_CASES } = require('../consistency/checkConsistency')
const { MIN_AGGREGATE_CASES, TREND_WINDOW_MONTHS, SCORE_BUCKETS, bucketForScore } = require('./analyticsThresholds')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const CASE_METADATA_COLLECTION = 'caseMetadata'
const REFERENCE_CASES_COLLECTION = 'referenceCases'
const ANALYTICS_SUBCOLLECTION = 'analytics'
const CONSISTENCY_DOC_ID = 'consistency'
const DAY_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 400

function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

// YYYY-MM in UTC, the same period key shape functions/src/intake/
// analyzePulseResponse.js's currentPeriod() and computeBenchmarks.js's
// monthly run-doc id already use across this codebase.
function periodOf(ms) {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// The last TREND_WINDOW_MONTHS period keys ending with the current month,
// oldest first - the fixed set of doc ids this run writes and the only ones
// it keeps, so a chart reading "the last 12 months" never has to guess
// whether a gap means "no cases" or "not computed yet".
function trailingPeriods(nowMs, count) {
  const periods = []
  const cursor = new Date(nowMs)
  cursor.setUTCDate(1)
  for (let i = 0; i < count; i += 1) {
    periods.unshift(periodOf(cursor.getTime()))
    cursor.setUTCMonth(cursor.getUTCMonth() - 1)
  }
  return periods
}

// Rounds a share to the nearest whole percentage point. Unlike the benchmark
// pool's round-to-5 (a cross-company published figure, rounded harder because
// it leaves the company entirely), this is a single company reading its own
// number back - one-point precision does not create a re-identification risk
// the company doesn't already have simply by holding the underlying rows.
function roundPercent(hit, total) {
  if (!total) return null
  return Math.round((hit / total) * 100)
}

// Applies the k-anonymity floor to a {key: count} breakdown - any key below
// MIN_AGGREGATE_CASES is dropped from the object entirely rather than shown
// with a small number, the same "not computed, not withheld" posture
// computeBenchmarks.js takes with a suppressed cell. `total` is left as the
// true count (a total case count for the company/period is not itself a
// segment small enough to re-identify anyone inside it).
function suppressSmallCounts(counts) {
  const out = {}
  for (const [key, count] of Object.entries(counts)) {
    if (count >= MIN_AGGREGATE_CASES) out[key] = count
  }
  return out
}

function tallyBy(rows, keyFn) {
  const counts = {}
  for (const row of rows) {
    const key = keyFn(row)
    if (!key) continue
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

// One trend document's worth of aggregates, built from this company's
// caseMetadata rows whose createdAt falls in the given period. Every number
// here comes from caseMetadata alone - no case content, no case id.
function buildPeriodDoc({ companyId, period, rows, complianceRule }) {
  const volumeByCategory = suppressSmallCounts(tallyBy(rows, (r) => r.category))
  const volumeByDepartment = suppressSmallCounts(tallyBy(rows, (r) => r.department))

  const closedInPeriod = rows.filter((r) => r.status === 'closed' && r.closedAt)
  const resolutionDays = closedInPeriod
    .map((r) => {
      const opened = toMillis(r.createdAt)
      const closed = toMillis(r.closedAt)
      if (opened === null || closed === null || closed < opened) return null
      return (closed - opened) / DAY_MS
    })
    .filter((v) => v !== null)
  const avgResolutionDays =
    resolutionDays.length >= MIN_AGGREGATE_CASES
      ? Number((resolutionDays.reduce((a, b) => a + b, 0) / resolutionDays.length).toFixed(1))
      : null

  // Compliance-deadline hit rate: measured only against cases whose deadline
  // has actually arrived (due date in the past) or been met, so a case still
  // inside its window doesn't count as a miss just because it hasn't been
  // acted on yet.
  const now = Date.now()
  let ackDueCount = 0
  let ackHitCount = 0
  let feedbackDueCount = 0
  let feedbackHitCount = 0
  for (const r of rows) {
    const ackDueAt = toMillis(r.acknowledgmentDueAt)
    if (ackDueAt !== null) {
      const ackSentAt = toMillis(r.acknowledgmentSentAt)
      if (ackSentAt !== null) {
        ackDueCount += 1
        if (ackSentAt <= ackDueAt) ackHitCount += 1
      } else if (ackDueAt <= now) {
        ackDueCount += 1
      }
    }
    const feedbackDueAt = toMillis(r.feedbackDueAt)
    if (feedbackDueAt !== null) {
      const closedAt = toMillis(r.closedAt)
      if (closedAt !== null) {
        feedbackDueCount += 1
        if (closedAt <= feedbackDueAt) feedbackHitCount += 1
      } else if (feedbackDueAt <= now) {
        feedbackDueCount += 1
      }
    }
  }

  const severityBuckets = {}
  const evidenceBuckets = {}
  for (const bucket of SCORE_BUCKETS) {
    severityBuckets[bucket.id] = 0
    evidenceBuckets[bucket.id] = 0
  }
  for (const r of rows) {
    const sBucket = bucketForScore(r.severityScore)
    if (sBucket) severityBuckets[sBucket] += 1
    const eBucket = bucketForScore(r.evidenceScore)
    if (eBucket) evidenceBuckets[eBucket] += 1
  }
  // The whole distribution is withheld below the floor, not bucket-by-bucket -
  // a period with 3 cases showing "2 in 61-80" is exactly as re-identifying
  // as showing the 2 raw scores would be, regardless of which bucket they
  // land in.
  const distributionSuppressed = rows.length < MIN_AGGREGATE_CASES

  return {
    kind: 'trend',
    period,
    companyId,
    caseCount: rows.length,
    volumeByCategory,
    volumeByDepartment,
    avgResolutionDays,
    resolutionSampleSize: resolutionDays.length,
    compliance: {
      ruleLabel: complianceRule.label,
      acknowledgmentDueDays: complianceRule.acknowledgmentDueDays,
      feedbackDueDays: complianceRule.feedbackDueDays,
      acknowledgedWithinWindowRate: roundPercent(ackHitCount, ackDueCount),
      resolvedWithinWindowRate: roundPercent(feedbackHitCount, feedbackDueCount),
      acknowledgmentSampleSize: ackDueCount,
      resolutionSampleSize: feedbackDueCount,
    },
    severityDistribution: distributionSuppressed ? null : severityBuckets,
    evidenceDistribution: distributionSuppressed ? null : evidenceBuckets,
    distributionSuppressed,
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
  }
}

// The Consistency Engine summary: per category, whether this company has
// enough of its own closed-case history (referenceCases, never cases/{caseId})
// to say anything, and if so, where its own historical pattern sits - the
// same "typical action for cases like this one" signal checkConsistency.js
// computes per-case, aggregated here across every closed case in the
// category instead of shown one flag at a time.
//
// Deliberately recomputed from referenceCases rather than read off each
// case's stored consistencyCheck field: that field lives on cases/{caseId},
// which this module is barred from reading at all, and referenceCases already
// carries everything the comparison itself needs (severityScore, department
// tier, actionTaken, category) without reaching for anything this module
// cannot touch.
function buildConsistencyDoc({ companyId, referenceRows }) {
  const byCategory = {}

  for (const category of CATEGORIES) {
    const categoryRows = referenceRows.filter((r) => r.category === category)
    if (categoryRows.length < MIN_REFERENCE_CASES) {
      byCategory[category] = { status: 'insufficient_data', referenceCaseCount: categoryRows.length }
      continue
    }

    const departments = {}
    let harsherCount = 0
    let lenientCount = 0
    let consistentCount = 0
    let unrankableCount = 0

    const byDepartment = new Map()
    for (const row of categoryRows) {
      const tier = row.department ?? 'unspecified'
      if (!byDepartment.has(tier)) byDepartment.set(tier, [])
      byDepartment.get(tier).push(row)
    }

    for (const [tier, tierRows] of byDepartment) {
      if (tierRows.length < MIN_AGGREGATE_CASES) continue // too small to publish this segment at all

      const typicalAction = mostCommonAction(tierRows.map((r) => r.actionTaken))
      const typicalRank = actionRank(typicalAction)

      const severityActionCounts = {}
      for (const bucket of SCORE_BUCKETS) severityActionCounts[bucket.id] = {}

      for (const row of tierRows) {
        const bucketId = bucketForScore(row.severityScore)
        const action = normalizeAction(row.actionTaken)
        if (bucketId && action) {
          severityActionCounts[bucketId][action] = (severityActionCounts[bucketId][action] ?? 0) + 1
        }

        const rowRank = actionRank(row.actionTaken)
        if (rowRank === null || typicalRank === null) {
          unrankableCount += 1
        } else if (rowRank === typicalRank) {
          consistentCount += 1
        } else if (rowRank > typicalRank) {
          harsherCount += 1
        } else {
          lenientCount += 1
        }
      }

      departments[tier] = {
        caseCount: tierRows.length,
        typicalAction,
        severityActionCounts,
      }
    }

    byCategory[category] = {
      status: Object.keys(departments).length > 0 ? 'ok' : 'insufficient_data',
      referenceCaseCount: categoryRows.length,
      departments,
      harsherCount,
      lenientCount,
      consistentCount,
      unrankableCount,
    }
  }

  return {
    kind: 'consistency',
    companyId,
    byCategory,
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
  }
}

async function commitInChunks(firestore, operations) {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = firestore.batch()
    for (const op of operations.slice(i, i + BATCH_SIZE)) op(batch)
    await batch.commit()
  }
}

// Recomputes one company's whole analytics subcollection from scratch, the
// same "computed, not accumulated" posture computeBenchmarks.js takes:
// every trend period and the consistency summary are overwritten in full on
// every run, so a correction to caseMetadata or referenceCases is reflected
// completely on the next run rather than partially through an incremental
// counter that could drift.
//
// Reads exactly two collections, both metadata-only mirrors, never
// cases/{caseId} or any messages subcollection: caseMetadata (module 13's
// HR-Coordinator-safe mirror) and referenceCases (module 10's cross-case
// pool, scoped here to this company only - the cross-company comparison is
// the separate, later benchmark module and is out of scope here).
async function recomputeCompanyAnalytics(firestore, companyId, jurisdictions, nowMs) {
  const [metadataSnapshot, referenceSnapshot] = await Promise.all([
    firestore.collection(CASE_METADATA_COLLECTION).where('companyId', '==', companyId).get(),
    firestore.collection(REFERENCE_CASES_COLLECTION).where('companyId', '==', companyId).get(),
  ])

  const metadataRows = metadataSnapshot.docs.map((doc) => doc.data())
  const referenceRows = referenceSnapshot.docs.map((doc) => doc.data())
  const complianceRule = getStrictestRule(jurisdictions)

  const periods = trailingPeriods(nowMs, TREND_WINDOW_MONTHS)
  const rowsByPeriod = new Map(periods.map((p) => [p, []]))
  for (const row of metadataRows) {
    const createdMs = toMillis(row.createdAt)
    if (createdMs === null) continue
    const period = periodOf(createdMs)
    if (rowsByPeriod.has(period)) rowsByPeriod.get(period).push(row)
  }

  const analyticsCollection = firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(ANALYTICS_SUBCOLLECTION)

  const operations = []
  for (const period of periods) {
    const doc = buildPeriodDoc({ companyId, period, rows: rowsByPeriod.get(period), complianceRule })
    operations.push((batch) => batch.set(analyticsCollection.doc(`trend_${period}`), doc))
  }

  const consistencyDoc = buildConsistencyDoc({ companyId, referenceRows })
  operations.push((batch) => batch.set(analyticsCollection.doc(CONSISTENCY_DOC_ID), consistencyDoc))

  // Prune trend docs older than the rolling window - see trailingPeriods'
  // comment on why a stale doc is worse than a missing one.
  const keepIds = new Set(periods.map((p) => `trend_${p}`))
  keepIds.add(CONSISTENCY_DOC_ID)
  const existing = await analyticsCollection.get()
  for (const doc of existing.docs) {
    if (!keepIds.has(doc.id)) operations.push((batch) => batch.delete(doc.ref))
  }

  await commitInChunks(firestore, operations)
}

// Runs daily. Never reads cases/{caseId} or any messages subcollection - see
// the module-level comment on recomputeCompanyAnalytics for the two
// collections this reads and why that is the whole read surface.
exports.aggregateCaseAnalytics = onSchedule('every day 03:30', async () => {
  const firestore = admin.firestore()
  const nowMs = Date.now()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()

  let succeeded = 0
  let failed = 0
  for (const companyDoc of companiesSnapshot.docs) {
    const companyId = companyDoc.id
    const jurisdictions = companyDoc.data().jurisdictions ?? []
    try {
      await recomputeCompanyAnalytics(firestore, companyId, jurisdictions, nowMs)
      succeeded += 1
    } catch (error) {
      failed += 1
      logger.error('aggregateCaseAnalytics: company recompute failed', { companyId, error: error.message })
    }
  }

  logger.info('aggregateCaseAnalytics: run complete', { succeeded, failed, total: companiesSnapshot.size })
})

// Exported for exportComplianceReport.js, which needs the same trailing-
// period trend rows and consistency summary to compile a PDF over a caller-
// selected date range without a third copy of this aggregation logic.
exports.recomputeCompanyAnalytics = recomputeCompanyAnalytics
exports.trailingPeriods = trailingPeriods
exports.periodOf = periodOf
