import { useCallback, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  CATEGORY_LABELS,
  exportComplianceReport,
  getConsistencyInsights,
  listAnalyticsTrend,
} from '../../services/analyticsService'
import ConsistencyInsights from './ConsistencyInsights'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import StatTile from '../ui/StatTile'
import { SkeletonStats, SkeletonList } from '../ui/Loading'

const SCORE_BUCKET_ORDER = ['0-20', '21-40', '41-60', '61-80', '81-100']

function formatPercent(value) {
  return value == null ? '-' : `${value}%`
}

function sumField(periods, field) {
  return periods.reduce((total, p) => total + (p[field] ?? 0), 0)
}

// A simple horizontal bar list - no charting library in this app (see
// BenchmarkComparison.jsx for the same plain-div convention), and every
// value plotted here already passed the k-anonymity floor before this
// component ever saw it (aggregateCaseAnalytics.js omits any key below
// MIN_AGGREGATE_CASES from the document entirely).
function BarList({ entries, labelFor, max }) {
  const { t } = useTranslation()
  if (entries.length === 0) {
    return <p className="text-xs text-muted">{t('analyticsDashboard.noSegment')}</p>
  }
  const peak = max ?? Math.max(...entries.map(([, count]) => count), 1)
  return (
    <ul className="flex flex-col gap-2">
      {entries.map(([key, count]) => (
        <li key={key} className="flex items-center gap-3 text-xs">
          <span className="w-32 shrink-0 truncate text-charcoal">{labelFor ? labelFor(key) : key}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-navy-50">
            <span
              className="block h-full rounded-full bg-info"
              style={{ width: `${Math.max(4, (count / peak) * 100)}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right tabular-nums text-muted">{count}</span>
        </li>
      ))}
    </ul>
  )
}

// One row per trend period, sparkline-style bars for a single numeric field.
function TrendBars({ periods, field, format = (v) => v, emptyLabel }) {
  const { t } = useTranslation()
  const resolvedEmptyLabel = emptyLabel ?? t('analyticsDashboard.noData')
  const values = periods.map((p) => p[field]).filter((v) => v != null)
  const peak = Math.max(...values, 1)
  return (
    <ul className="flex flex-col gap-1.5">
      {periods.map((p) => {
        const value = p[field]
        return (
          <li key={p.period} className="flex items-center gap-3 text-xs">
            <span className="w-16 shrink-0 text-muted">{p.period}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-navy-50">
              {value != null && (
                <span
                  className="block h-full rounded-full bg-low"
                  style={{ width: `${Math.max(4, (value / peak) * 100)}%` }}
                />
              )}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-charcoal">
              {value == null ? resolvedEmptyLabel : format(value)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function DistributionBars({ period }) {
  const { t } = useTranslation()
  if (period.distributionSuppressed || !period.severityDistribution) {
    return <p className="text-xs text-muted">{t('analyticsDashboard.insufficientForDistribution')}</p>
  }
  const severityEntries = SCORE_BUCKET_ORDER.map((band) => [band, period.severityDistribution[band] ?? 0])
  const evidenceEntries = SCORE_BUCKET_ORDER.map((band) => [band, period.evidenceDistribution[band] ?? 0])
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{t('analyticsDashboard.severityScore')}</p>
        <BarList entries={severityEntries} />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{t('analyticsDashboard.evidenceScore')}</p>
        <BarList entries={evidenceEntries} />
      </div>
    </div>
  )
}

// Module 28's trend dashboard: case volume, time-to-resolution, compliance
// deadline hit rate and severity/evidence distribution, all read from
// companies/{companyId}/analytics/* - never caseMetadata directly and never
// cases/{caseId}. `canExport` gates the board/audit PDF button, not the
// dashboard itself: viewing is open to companyAdmin, hrCoordinator and
// caseHandler alike (see firestore.rules), but exporting an offline copy is
// narrower - see exportComplianceReport.js for why.
function AnalyticsDashboard({ companyId, canExport = false }) {
  const { t } = useTranslation()
  const [trend, setTrend] = useState([])
  const [consistency, setConsistency] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [exportResult, setExportResult] = useState(null)

  const refresh = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const [trendRows, consistencyData] = await Promise.all([
        listAnalyticsTrend(companyId),
        getConsistencyInsights(companyId),
      ])
      setTrend(trendRows)
      setConsistency(consistencyData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const latestPeriod = trend[trend.length - 1] ?? null
  const totalCaseCount = useMemo(() => sumField(trend, 'caseCount'), [trend])

  const categoryTotals = useMemo(() => {
    const totals = {}
    for (const period of trend) {
      for (const [category, count] of Object.entries(period.volumeByCategory || {})) {
        totals[category] = (totals[category] ?? 0) + count
      }
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1])
  }, [trend])

  const departmentTotals = useMemo(() => {
    const totals = {}
    for (const period of trend) {
      for (const [department, count] of Object.entries(period.volumeByDepartment || {})) {
        totals[department] = (totals[department] ?? 0) + count
      }
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1])
  }, [trend])

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    setExportResult(null)
    try {
      const result = await exportComplianceReport({
        startPeriod: trend[0]?.period,
        endPeriod: latestPeriod?.period,
      })
      setExportResult(result)
    } catch (err) {
      setExportError(err.message)
    } finally {
      setExporting(false)
    }
  }

  if (loading && trend.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <SkeletonStats count={4} />
        <SkeletonList rows={4} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">{t('analyticsDashboard.intro')}</p>
        <div className="flex items-center gap-2">
          <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel={t('analyticsDashboard.refreshing')}>
            {t('analyticsDashboard.refresh')}
          </Button>
          {canExport && (
            <Button
              variant="primary"
              icon="document"
              onClick={handleExport}
              loading={exporting}
              loadingLabel={t('analyticsDashboard.compiling')}
              disabled={trend.length === 0}
            >
              {t('analyticsDashboard.exportReport')}
            </Button>
          )}
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {exportError && <Alert variant="error">{exportError}</Alert>}
      {exportResult && (
        <Alert variant="success" title={t('analyticsDashboard.reportReady.title')}>
          <Trans
            i18nKey="analyticsDashboard.reportReady.body"
            values={{
              start: exportResult.range.startPeriod,
              end: exportResult.range.endPeriod,
              pages: exportResult.pageCount,
            }}
            components={{
              link: (
                <a
                  href={exportResult.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                />
              ),
            }}
          />
        </Alert>
      )}

      {trend.length === 0 ? (
        <EmptyState
          icon="overview"
          title={t('analyticsDashboard.empty.title')}
          description={t('analyticsDashboard.empty.description')}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <StatTile label={t('analyticsDashboard.totalCaseVolume')} hint={t('analyticsDashboard.trailing12Months')} value={totalCaseCount} tone="tone-info" icon="cases" />
            <StatTile
              label={t('analyticsDashboard.avgTimeToResolution')}
              hint={latestPeriod?.period}
              value={latestPeriod?.avgResolutionDays == null ? '-' : t('analyticsDashboard.daysValue', { days: latestPeriod.avgResolutionDays })}
              tone="tone-neutral"
              icon="clock"
            />
            <StatTile
              label={t('analyticsDashboard.acknowledgedWithinWindow')}
              hint={latestPeriod?.compliance?.ruleLabel}
              value={formatPercent(latestPeriod?.compliance?.acknowledgedWithinWindowRate)}
              tone={
                latestPeriod?.compliance?.acknowledgedWithinWindowRate != null &&
                latestPeriod.compliance.acknowledgedWithinWindowRate < 80
                  ? 'tone-high'
                  : 'tone-low'
              }
              icon="check"
            />
            <StatTile
              label={t('analyticsDashboard.resolvedWithinWindow')}
              hint={latestPeriod?.compliance?.ruleLabel}
              value={formatPercent(latestPeriod?.compliance?.resolvedWithinWindowRate)}
              tone={
                latestPeriod?.compliance?.resolvedWithinWindowRate != null &&
                latestPeriod.compliance.resolvedWithinWindowRate < 80
                  ? 'tone-high'
                  : 'tone-low'
              }
              icon="check"
            />
          </div>

          <Card title={t('analyticsDashboard.byCategory.title')} description={t('analyticsDashboard.byCategory.description')}>
            <BarList
              entries={categoryTotals}
              labelFor={(key) => t(`categories.${key}.label`, { defaultValue: CATEGORY_LABELS[key] ?? key })}
            />
          </Card>

          <Card title={t('analyticsDashboard.byDepartment.title')} description={t('analyticsDashboard.byDepartment.description')}>
            <BarList entries={departmentTotals} />
          </Card>

          <Card title={t('analyticsDashboard.avgResolutionTime.title')} description={t('analyticsDashboard.avgResolutionTime.description')}>
            <TrendBars periods={trend} field="avgResolutionDays" format={(v) => t('analyticsDashboard.daysValue', { days: v })} />
          </Card>

          <Card
            title={t('analyticsDashboard.complianceHitRate.title')}
            description={t('analyticsDashboard.complianceHitRate.description')}
          >
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{t('analyticsDashboard.acknowledgedInWindow')}</p>
                <TrendBars periods={trend.map((p) => ({ period: p.period, value: p.compliance.acknowledgedWithinWindowRate }))} field="value" format={formatPercent} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{t('analyticsDashboard.resolvedInWindow')}</p>
                <TrendBars periods={trend.map((p) => ({ period: p.period, value: p.compliance.resolvedWithinWindowRate }))} field="value" format={formatPercent} />
              </div>
            </div>
          </Card>

          <Card
            title={t('analyticsDashboard.distribution.title')}
            description={t('analyticsDashboard.distribution.description')}
            actions={
              latestPeriod?.distributionSuppressed ? (
                <Badge tone="tone-neutral">{t('analyticsDashboard.insufficientData')}</Badge>
              ) : null
            }
          >
            {latestPeriod && <DistributionBars period={latestPeriod} />}
          </Card>

          <ConsistencyInsights data={consistency} loading={loading && !consistency} />
        </>
      )}
    </div>
  )
}

export default AnalyticsDashboard
