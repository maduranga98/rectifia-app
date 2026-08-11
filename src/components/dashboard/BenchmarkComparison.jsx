import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          <span className="text-muted">
            {t(`actionLabels.${action}`, { defaultValue: ACTION_LABELS[action] ?? action })}
          </span>
        </li>
      ))}
    </ul>
  )
}

function CellRow({ cell }) {
  const { t } = useTranslation()
  const label = t(`categories.${cell.category}.label`, { defaultValue: CATEGORY_LABELS[cell.category] ?? cell.category })

  if (cell.suppressed) {
    return (
      <div className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-charcoal">{label}</span>
          <Badge tone="tone-neutral">{t('benchmarkComparison.insufficientData')}</Badge>
        </div>
        <p className="text-xs text-muted">{t('benchmarkComparison.insufficientDataBody')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-charcoal">{label}</span>
        <Badge tone="tone-low" dot>
          {t('benchmarkComparison.companiesAndCases', {
            companies: cell.contributingCompanyCount,
            cases: cell.caseCount,
          })}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('benchmarkComparison.severityMedian')}</p>
          <p className="mt-0.5 text-charcoal">
            {formatNumber(cell.severityScoreMedian)}
            <span className="text-xs text-muted">
              {' '}
              {t('benchmarkComparison.percentiles', {
                p25: formatNumber(cell.severityScoreP25),
                p75: formatNumber(cell.severityScoreP75),
              })}
            </span>
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('benchmarkComparison.evidenceMedian')}</p>
          <p className="mt-0.5 text-charcoal">{formatNumber(cell.evidenceScoreMedian)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('benchmarkComparison.daysToCloseMedian')}</p>
          <p className="mt-0.5 text-charcoal">{formatNumber(cell.daysToCloseMedian, t('benchmarkComparison.daysUnit'))}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('benchmarkComparison.casesPer1000')}</p>
          <p className="mt-0.5 text-charcoal">{formatNumber(cell.casesPer1000EmployeesPerYear)}</p>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted">{t('benchmarkComparison.typicalAction')}</p>
        <div className="mt-1">
          <TopActions distribution={cell.actionDistribution} />
        </div>
      </div>
    </div>
  )
}

function BenchmarkComparison({ companyId }) {
  const { t } = useTranslation()
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
      title={t('benchmarkComparison.title')}
      description={t('benchmarkComparison.description')}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert variant="error">{error}</Alert>}

        {loading && !data ? (
          <SkeletonList rows={3} />
        ) : !data?.optedIn ? (
          <Alert variant="info" title={t('benchmarkComparison.notOptedIn.title')}>
            {t('benchmarkComparison.notOptedIn.body')}
          </Alert>
        ) : data.incomplete ? (
          <Alert variant="warning" title={t('benchmarkComparison.incomplete.title')}>
            {t('benchmarkComparison.incomplete.body')}
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>
                <Trans
                  i18nKey="benchmarkComparison.showingSegment"
                  values={{ industry: industryLabel, sizeBand: data.sizeBand }}
                  components={{ strong: <strong className="text-charcoal" /> }}
                />
              </span>
            </div>

            {data.cells.length === 0 ? (
              <EmptyState
                compact
                icon="search"
                title={t('benchmarkComparison.noCells.title')}
                description={t('benchmarkComparison.noCells.description')}
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

            <p className="text-xs text-muted">{t('benchmarkComparison.roundingFootnote')}</p>
          </>
        )}
      </div>
    </Card>
  )
}

export default BenchmarkComparison
