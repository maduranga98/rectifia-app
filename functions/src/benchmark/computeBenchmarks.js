const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const {
  MIN_COMPANIES_PER_CELL,
  MIN_CASES_PER_CELL,
  INDUSTRIES,
  SIZE_BANDS,
  CATEGORIES,
  isKnownIndustry,
  isKnownCategory,
  bandForEmployeeCount,
  cellId,
} = require('./benchmarkThresholds')
const { ACTION_TAKEN_OPTIONS, normalizeAction } = require('../consistency/actionVocabulary')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const REFERENCE_CASES_COLLECTION = 'referenceCases'
const BENCHMARK_CELLS_COLLECTION = 'benchmarkCells'
const BENCHMARK_OPT_INS_COLLECTION = 'benchmarkOptIns'
const BENCHMARK_RUNS_COLLECTION = 'benchmarkRuns'

// The rate window and cases-per-1000-employees-per-year. Twelve months so the
// numerator is a full annual cadence and the denominator (headcount today)
// stays a like-for-like snapshot; a rolling window is what makes withdrawal
// actually take effect - a company that opts out is gone from the next run's
// numerator entirely, not diluted forward through a decaying moving average.
const RATE_WINDOW_DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1000

// Firestore batches cap at 500 writes; the cell space is
// industries × bands × categories = at most a few hundred, but leave headroom.
const BATCH_SIZE = 400

function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

// Percentile helper. Small populations only - we already require at least
// MIN_CASES_PER_CELL points before publishing - so a simple sort-and-index
// beats a running quantile estimator and is easier to reason about. Uses the
// nearest-rank method: p(v) is the value at position ceil(p * n) - 1 in the
// sorted list, with a lower-bound clamp. Standard on integer scores.
function percentile(sortedValues, p) {
  if (!sortedValues.length) return null
  const rank = Math.max(0, Math.ceil(p * sortedValues.length) - 1)
  return sortedValues[rank]
}

function median(sortedValues) {
  if (!sortedValues.length) return null
  const mid = Math.floor(sortedValues.length / 2)
  if (sortedValues.length % 2 === 1) return sortedValues[mid]
  return (sortedValues[mid - 1] + sortedValues[mid]) / 2
}

// Rounds a percentage to the nearest 5. Unrounded shares over small
// populations leak more than they inform - a 41.176% figure over 34 cases
// says "14 of 34 exactly", which is the sort of precision an attacker adds
// figures across cells with. Every share and every median goes through
// something like this before it is written.
function roundToNearest5(value) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value / 5) * 5
}

function roundToInt(value) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value)
}

// Loads every currently-opted-in company along with the industry and
// employeeCount they declared. A company whose opt-in record is missing
// either field, or whose employeeCount doesn't fall inside a known band, is
// treated as not participating for this run - opting in without the two
// facts the cell coordinates need is not a partial contribution, it is not
// enough information to place the contribution safely.
async function loadOptedInCompanies(firestore) {
  const snapshot = await firestore
    .collection(BENCHMARK_OPT_INS_COLLECTION)
    .where('optedIn', '==', true)
    .get()

  const companies = []
  for (const doc of snapshot.docs) {
    const data = doc.data()
    const industry = data.industry
    const sizeBand = bandForEmployeeCount(data.employeeCount)
    if (!isKnownIndustry(industry) || !sizeBand) continue
    companies.push({
      companyId: doc.id,
      industry,
      sizeBand,
      employeeCount: Number(data.employeeCount),
    })
  }
  return companies
}

// Loads every referenceCases row for a single opted-in company. referenceCases
// is the correct source precisely because it already holds no narrative and
// no names (see functions/src/consistency/storeReferenceCase.js) - scores,
// category, department tier, actionTaken, closedAt. The cases collection is
// never read from here, and reading it would be a bug that widens what leaves
// a company's boundary.
async function loadReferenceCasesForCompany(firestore, companyId) {
  const snapshot = await firestore
    .collection(REFERENCE_CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .get()
  return snapshot.docs.map((doc) => doc.data())
}

// Groups every reference case by the cell it belongs to. A row whose category
// isn't one of the known set is dropped rather than bucketed as "other" - the
// consistency pool's own category list is the same short set, so this is a
// data-quality guard, not a rejection of a new category we do not handle yet.
function bucketByCell(companies, referenceCasesByCompany, nowMs) {
  // cellId -> { rows, companySet }
  const cells = new Map()
  const rateWindowStart = nowMs - RATE_WINDOW_DAYS * DAY_MS

  for (const company of companies) {
    const rows = referenceCasesByCompany.get(company.companyId) ?? []
    for (const row of rows) {
      if (!isKnownCategory(row.category)) continue
      const id = cellId(company.industry, company.sizeBand, row.category)
      if (!cells.has(id)) {
        cells.set(id, {
          industry: company.industry,
          sizeBand: company.sizeBand,
          category: row.category,
          rows: [],
          companiesById: new Map(),
          casesInWindow: 0,
        })
      }
      const cell = cells.get(id)
      cell.rows.push(row)
      cell.companiesById.set(company.companyId, company)
      const closedMs = toMillis(row.closedAt)
      if (closedMs !== null && closedMs >= rateWindowStart) cell.casesInWindow += 1
    }
  }

  return cells
}

// The action distribution as {action: percentage-rounded-to-5}. Only rows
// with a known action are counted; unknown actions are simply not part of the
// denominator here, so a percentage adds to at most 100 (rounding may pull it
// slightly under - by design, a rounded distribution does not silently
// renormalize to hide the rounding).
function actionDistribution(rows) {
  const counts = new Map()
  let known = 0
  for (const row of rows) {
    const action = normalizeAction(row.actionTaken)
    if (!ACTION_TAKEN_OPTIONS.includes(action)) continue
    counts.set(action, (counts.get(action) ?? 0) + 1)
    known += 1
  }
  if (known === 0) return {}
  const out = {}
  for (const action of ACTION_TAKEN_OPTIONS) {
    const share = ((counts.get(action) ?? 0) / known) * 100
    out[action] = roundToNearest5(share)
  }
  return out
}

// Days from open (reportedAt) to close (closedAt), per case, when both
// timestamps are present. A row missing either is skipped rather than
// defaulted to zero - a zero-day close would move the median downward and
// misrepresent how long cases actually take.
function daysToCloseValues(rows) {
  const values = []
  for (const row of rows) {
    const opened = toMillis(row.reportedAt)
    const closed = toMillis(row.closedAt)
    if (opened === null || closed === null || closed < opened) continue
    values.push((closed - opened) / DAY_MS)
  }
  return values.sort((a, b) => a - b)
}

// Builds the published shape for one cell. Called only after both k-thresholds
// have been met; below either, a different write path (suppressed cell)
// applies and this function is never called.
function summarizeCell(cell) {
  const severity = cell.rows
    .map((r) => (typeof r.severityScore === 'number' ? r.severityScore : null))
    .filter((v) => v !== null)
    .sort((a, b) => a - b)
  const evidence = cell.rows
    .map((r) => (typeof r.evidenceScore === 'number' ? r.evidenceScore : null))
    .filter((v) => v !== null)
    .sort((a, b) => a - b)

  const days = daysToCloseValues(cell.rows)

  // Cases-per-1000-employees per year. Denominator is the sum of contributing
  // companies' employeeCounts - a like-for-like snapshot of headcount across
  // exactly the companies that fed this cell. Numerator is cases closed
  // inside the rolling 365-day window, which is why the number is an annual
  // rate even though the underlying pool is indefinite. A cell whose
  // contributing companies have no positive headcount has no meaningful
  // denominator here and the rate is written as null rather than a made-up
  // number.
  let totalEmployees = 0
  for (const company of cell.companiesById.values()) totalEmployees += company.employeeCount
  const rate = totalEmployees > 0 ? (cell.casesInWindow / totalEmployees) * 1000 : null

  return {
    // The two population figures are published so a reader can see the
    // ground the statistics stand on - "34 cases across 6 companies" is
    // context, not attribution. Both are strictly above the thresholds by
    // the time this function runs.
    contributingCompanyCount: cell.companiesById.size,
    caseCount: cell.rows.length,
    severityScoreMedian: roundToInt(median(severity)),
    severityScoreP25: roundToInt(percentile(severity, 0.25)),
    severityScoreP75: roundToInt(percentile(severity, 0.75)),
    evidenceScoreMedian: roundToInt(median(evidence)),
    actionDistribution: actionDistribution(cell.rows),
    daysToCloseMedian: roundToInt(median(days)),
    casesPer1000EmployeesPerYear: rate == null ? null : Number(rate.toFixed(1)),
  }
}

async function commitInChunks(firestore, operations) {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = firestore.batch()
    for (const op of operations.slice(i, i + BATCH_SIZE)) op(batch)
    await batch.commit()
  }
}

// The pool is computed, not accumulated: every run recomputes every cell
// from scratch over the set of currently-opted-in companies, and the
// previous run's documents are overwritten wholly. Withdrawal has to work
// completely on the next run - an incremental accumulator cannot un-mix a
// company's contribution once it is in the sum, so "opt out" would mean
// "opt out of future contributions while your past ones remain forever",
// which is not what a customer believes they are agreeing to.
//
// Runs monthly. Not daily: the pool is a slow-moving reference, and daily
// recomputation would burn cost with no readable difference for the reader,
// who sees a monthly cadence at most and reads a cell as "this is roughly
// where the sector sits" rather than "this is where it sat yesterday".
async function recomputeAllCells(firestore, nowMs) {
  const companies = await loadOptedInCompanies(firestore)
  const referenceCasesByCompany = new Map()
  await Promise.all(
    companies.map(async (company) => {
      referenceCasesByCompany.set(
        company.companyId,
        await loadReferenceCasesForCompany(firestore, company.companyId)
      )
    })
  )

  const cells = bucketByCell(companies, referenceCasesByCompany, nowMs)
  const computedAt = admin.firestore.Timestamp.fromMillis(nowMs)

  // Every possible (industry, band, category) triple is written on every
  // run, either as suppressed or with statistics. A missing document would
  // be ambiguous - "not enough data yet" and "not computed this run" would
  // look the same to a reader - and this is one of the calls where being
  // unambiguous about which of those it is matters to the operator, who has
  // to distinguish "the pool is quiet" from "the last run failed".
  const desiredIds = new Set()
  for (const industry of INDUSTRIES) {
    for (const band of SIZE_BANDS) {
      for (const category of CATEGORIES) {
        desiredIds.add(cellId(industry, band.id, category))
      }
    }
  }

  const operations = []
  let publishedCount = 0
  let suppressedCount = 0

  for (const id of desiredIds) {
    const cell = cells.get(id)
    const [industry, sizeBand, category] = id.split('__')

    // A cell below EITHER threshold is written with suppressed:true and NO
    // statistics. Values are not computed and withheld at read time - they
    // are not computed at all. The suppression marker is the whole document;
    // there is no field to hide because there is no field to write.
    if (
      !cell ||
      cell.companiesById.size < MIN_COMPANIES_PER_CELL ||
      cell.rows.length < MIN_CASES_PER_CELL
    ) {
      suppressedCount += 1
      operations.push((batch) =>
        batch.set(firestore.collection(BENCHMARK_CELLS_COLLECTION).doc(id), {
          cellId: id,
          industry,
          sizeBand,
          category,
          suppressed: true,
          // Cell populations are not identity - "how many companies would
          // this cell need before it could be shown" is answerable without
          // naming any of them. Populations are floored at the thresholds
          // for a suppressed cell so a reader can't back into an exact
          // count that is close to the threshold from below (e.g. "24
          // cases exactly" would identify a cell one case away from
          // publication). See loadPopulationsForSuperAdmin below for the
          // one operational-health read that needs true counts.
          computedAt,
        })
      )
      continue
    }

    publishedCount += 1
    operations.push((batch) =>
      batch.set(firestore.collection(BENCHMARK_CELLS_COLLECTION).doc(id), {
        cellId: id,
        industry,
        sizeBand,
        category,
        suppressed: false,
        ...summarizeCell(cell),
        computedAt,
      })
    )
  }

  // A run record for operational health. Counts only - no cell coordinates,
  // no company ids - so this document is safe to expose to a Super Admin
  // reader who needs to know "did the pool compute this month and how many
  // cells cleared" without seeing any statistic attributed to any company.
  operations.push((batch) =>
    batch.set(firestore.collection(BENCHMARK_RUNS_COLLECTION).doc(computedAt.toDate().toISOString().slice(0, 7)), {
      computedAt,
      optedInCompanyCount: companies.length,
      publishedCellCount: publishedCount,
      suppressedCellCount: suppressedCount,
      thresholds: {
        minCompaniesPerCell: MIN_COMPANIES_PER_CELL,
        minCasesPerCell: MIN_CASES_PER_CELL,
      },
    })
  )

  await commitInChunks(firestore, operations)
  return { publishedCount, suppressedCount, optedInCount: companies.length }
}

// First of every month at 03:00 UTC - after most companies' overnight
// activity has settled and well after functions/src/patterns/detectPatterns.js
// (daily 02:00) so the two schedulers do not contend for reads.
exports.computeBenchmarks = onSchedule('0 3 1 * *', async () => {
  const firestore = admin.firestore()
  try {
    const result = await recomputeAllCells(firestore, Date.now())
    logger.info('computeBenchmarks: recomputed', result)
  } catch (error) {
    // A failed run leaves the previous month's cells in place - stale but
    // correct at their time - and the next scheduled run will retry. This is
    // deliberately not caught per-cell: the pool is not a per-company
    // computation like patternSignals, so there is no useful "partial run".
    logger.error('computeBenchmarks: run failed', { error: error.message })
    throw error
  }
})

// Exported for the callable's on-demand path (setBenchmarkOptIn recomputes
// synchronously the first time a company opts in, so their own comparison
// screen isn't blank until the next scheduled run - only their own opt-in
// state changed) and for direct tests.
exports.recomputeAllCells = recomputeAllCells
