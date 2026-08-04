const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASE_METADATA_COLLECTION = 'caseMetadata'
const COMPANIES_COLLECTION = 'companies'
const CLOSED_STATUS = 'closed'
const APPROACHING_DEADLINE_WINDOW_MS = 48 * 60 * 60 * 1000

function tallyDeadlines(caseRow, now) {
  const dueDates = [caseRow.acknowledgmentDueAt, caseRow.feedbackDueAt].filter(Boolean).map((ts) => ts.toMillis())
  if (dueDates.length === 0) return { overdue: false, approaching: false }
  const nearest = Math.min(...dueDates)
  return {
    overdue: nearest <= now,
    approaching: nearest > now && nearest - now <= APPROACHING_DEADLINE_WINDOW_MS,
  }
}

// Recomputes the Company Admin overview rollup (module 15's Case KPIs
// overview) at companies/{companyId}/stats/overview from caseMetadata - the
// same metadata-only mirror the HR Coordinator dashboard reads, never
// cases/{caseId}. Full recompute rather than incremental counters: caseMetadata
// per company is small enough that a query-and-tally is simpler and can't
// drift, unlike FieldValue.increment() counters that a delete or backfill
// could desync. Called from syncCompanyStats.js (on every caseMetadata write)
// and from checkOverdueDeadlines.js (daily), since overdue/approaching counts
// go stale with the passage of time alone, not just on a write.
async function recomputeCompanyStats(firestore, companyId) {
  if (!companyId) return

  const snapshot = await firestore.collection(CASE_METADATA_COLLECTION).where('companyId', '==', companyId).get()
  const now = Date.now()

  const stats = {
    companyId,
    totalCount: 0,
    openCount: 0,
    closedCount: 0,
    byStatus: {},
    byPriority: {},
    byCategory: {},
    byHandler: {},
    overdueCount: 0,
    approachingDeadlineCount: 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }

  snapshot.docs.forEach((doc) => {
    const data = doc.data()
    stats.totalCount += 1

    const status = data.status ?? 'unknown'
    stats.byStatus[status] = (stats.byStatus[status] ?? 0) + 1
    if (status === CLOSED_STATUS) {
      stats.closedCount += 1
    } else {
      stats.openCount += 1

      const priority = data.priority ?? 'unassigned'
      stats.byPriority[priority] = (stats.byPriority[priority] ?? 0) + 1

      if (data.assignedHandlerId) {
        stats.byHandler[data.assignedHandlerId] = (stats.byHandler[data.assignedHandlerId] ?? 0) + 1
      }

      const { overdue, approaching } = tallyDeadlines(data, now)
      if (overdue) stats.overdueCount += 1
      if (approaching) stats.approachingDeadlineCount += 1
    }

    const category = data.category ?? 'uncategorized'
    stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1
  })

  await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection('stats')
    .doc('overview')
    .set(stats)
}

module.exports = { recomputeCompanyStats }
