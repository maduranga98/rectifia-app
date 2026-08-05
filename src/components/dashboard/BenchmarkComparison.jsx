import { useCallback, useEffect, useState } from 'react'
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  INDUSTRY_LABELS,
  getBenchmarksForCompany,
} from '../../services/benchmarkService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { SkeletonList } from '../ui/Loading'

// The comparison view for an HR Coordinator. Every row is one of the four
// case categories, shown as the cell the company's own industry and size
// band place them into. Nothing here names another company, and nothing here
// attributes a figure to any single company - including the caller's own.
// The pool publishes only after both k-thresholds are met, and the "not
// enough data in your segment" state below is common and normal, not an
// error - a reader who sees empty cells needs to know that.
function formatPercent(value) {
  if (value == null) return '—'
  return `${value}%`
}

function formatNumber(value, unit = '') {
  if (value == null) return '—'
  return unit ? `${value} ${unit}` : String(value)
}

// The rounded distribution shown as the top three action categories by share.
// Truncated on purpose - a full eight-row table over rounded 5% buckets is
// mostly zeros and noise, and the reader is looking for "what is typical",
// not the tail.
function TopActions({ distribution }) {
  if (!distribution || typeof distribution !== 'object') return <span>—</span>
  const entries = Object.entries(distribution)
    .filter(([, share]) => typeof share === 'number' && share > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (entries.length === 0) return <span>—</span>
  return (
    <ul className="flex flex-col gap-1">
      {entries.map(([action, share]) => (
        <li key={action} className="text-sm text-charcoal">
          <span className="font-medium">{formatPercent(share)}</span>{' '}
          <span className="text-muted">{ACTION_LABELS[action] ?? action}</span>
        </li>
      ))}
    </ul>
  )
}

function CellRow({ cell }) {
  const label = CATEGORY_LABELS[cell.category] ?? cell.category

  if (cell.suppressed) {
    return (
      <div className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-charcoal">{label}</span>
          <Badge tone="tone-neutral">Insufficient data in your segment</Badge>
        </div>
        <p className="text-xs text-muted">
          This cell has not reached the minimum of 5 contributing companies and 25 cases required
          before any figure is published. This is common and normal, not an error — the pool grows
          as more companies opt in.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-charcoal">{label}</span>
        <Badge tone="tone-low" dot>
          {cell.contributingCompanyCount} companies · {cell.caseCount} cases
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Severity (median)</p>
          <p className="mt-0.5 text-charcoal">
            {formatNumber(cell.severityScoreMedian)}
            <span className="text-xs text-muted">
              {' '}
              (p25 {formatNumber(cell.severityScoreP25)} · p75 {formatNumber(cell.severityScoreP75)})
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Evidence (median)</p>
          <p className="mt-0.5 text-charcoal">{formatNumber(cell.evidenceScoreMedian)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Days to close (median)</p>
          <p className="mt-0.5 text-charcoal">{formatNumber(cell.daysToCloseMedian, 'days')}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Cases / 1,000 / year</p>
          <p className="mt-0.5 text-charcoal">{formatNumber(cell.casesPer1000EmployeesPerYear)}</p>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Typical action taken</p>
        <div className="mt-1">
          <TopActions distribution={cell.actionDistribution} />
        </div>
      </div>
    </div>
  )
}

function BenchmarkComparison({ companyId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getBenchmarksForCompany()
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const industryLabel = data?.industry
    ? INDUSTRY_LABELS[data.industry] ?? data.industry
    : null

  return (
    <Card
      title="Industry benchmark"
      description="How this company's closed cases compare to the wider pool for your industry and size band. Aggregate statistics only — no other company is named, no case is exposed, and cells below the anonymity thresholds are not published at all."
    >
      <div className="flex flex-col gap-4">
        {error && <Alert variant="error">{error}</Alert>}

        {loading && !data ? (
          <SkeletonList rows={3} />
        ) : !data?.optedIn ? (
          <Alert variant="info" title="Not opted in">
            The cross-company benchmark pool is opt-in. Your Company Admin can enable it on the
            company Benchmark page. Reading the pool requires contributing to it — a pool that can
            be read without contributing collapses into a one-way intelligence product.
          </Alert>
        ) : data.incomplete ? (
          <Alert variant="warning" title="Cell coordinates missing">
            Your opt-in record's industry or employee count no longer places this company inside a
            valid cell. Ask your Company Admin to re-opt-in with the current headcount.
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>
                Showing <strong className="text-charcoal">{industryLabel}</strong> in size band{' '}
                <strong className="text-charcoal">{data.sizeBand}</strong>.
              </span>
            </div>

            {data.cells.length === 0 ? (
              <EmptyState
                compact
                icon="search"
                title="No cells for your segment yet"
                description="No category cell has reached the reporting thresholds for your industry and size band. This is common and normal — the pool grows as more companies opt in."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {data.cells.map((cell) => (
                  <li key={cell.cellId}>
                    <CellRow cell={cell} />
                  </li>
                ))}
              </ul>
            )}

            <p className="text-xs text-muted">
              Cells publish only when at least 5 companies and 25 cases contribute; below either
              threshold nothing is published at all, so an "insufficient data" row is not an
              error. Every published figure is rounded — medians, percentages to the nearest 5 —
              because unrounded values over small populations leak more than they inform.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

export default BenchmarkComparison
