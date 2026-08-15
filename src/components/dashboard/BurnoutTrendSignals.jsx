import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  formatSignalDate,
  getBurnoutTrendSummary,
  listCompanyBurnoutTrendSignals,
} from '../../services/patternService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { SkeletonList } from '../ui/Loading'

function sortSignals(signals) {
  return [...signals].sort((a, b) => (b.caseCount ?? 0) - (a.caseCount ?? 0))
}

function formatRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) ? `${rate.toFixed(1)}x` : null
}

// HR-Coordinator-only company-wide burnout trend section, on the same
// PatternsPage as PatternSignals rather than a page of its own - a separate
// section, not a separate screen, because the two signal types are related
// enough that an HR Coordinator should see both while investigating, but
// must never be able to read one as a stronger version of the other.
//
// Every row here is department-level report volume: how many burnout
// reports named this department as the reporter's own team, over a rolling
// window, and how that compares to the company-wide rate for the same
// window. There is no accused party, no per-person clustering, and nothing
// here should ever be read as a conclusion about working conditions,
// management, or any individual - the copy says so directly, same
// discipline patternService.js's describeSignal holds pattern signals to.
function BurnoutTrendSignals({ companyId }) {
  const { t } = useTranslation()
  const [signals, setSignals] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [signalRows, summaryRow] = await Promise.all([
        listCompanyBurnoutTrendSignals(companyId),
        getBurnoutTrendSummary(companyId),
      ])
      setSignals(sortSignals(signalRows))
      setSummary(summaryRow)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const windowDays = summary?.windowDays ?? signals[0]?.windowDays ?? 180

  return (
    <Card
      title={t('burnoutTrendSignals.title')}
      description={t('burnoutTrendSignals.description', { windowDays })}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert variant="error">{error}</Alert>}

        {loading && signals.length === 0 ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {signals.length === 0 ? (
              <EmptyState
                compact
                icon="search"
                title={t('burnoutTrendSignals.empty.title')}
                description={t('burnoutTrendSignals.empty.description', { windowDays })}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {signals.map((signal) => {
                  const rate = formatRate(signal.rateVsCompanyAverage)
                  return (
                    <li key={signal.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium capitalize text-charcoal">
                          {signal.department}
                        </span>
                        {rate && (
                          <Badge tone="tone-neutral">
                            {t('burnoutTrendSignals.rateBadge', { rate })}
                          </Badge>
                        )}
                      </div>

                      <p className="text-sm text-charcoal">
                        {t('burnoutTrendSignals.describeSignal', {
                          count: signal.caseCount,
                          windowDays: signal.windowDays,
                        })}
                      </p>

                      <p className="text-xs text-muted">
                        {t('burnoutTrendSignals.dateRange', {
                          first: formatSignalDate(signal.firstReportedAt),
                          last: formatSignalDate(signal.lastReportedAt),
                        })}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}

            {summary?.suppressedCount > 0 && (
              <Alert variant="info" title={t('burnoutTrendSignals.suppressionNotice.title')}>
                <p>
                  {t('burnoutTrendSignals.suppressionNotice.body', {
                    count: summary.suppressedCount,
                    minPopulation: summary.minPopulation,
                  })}
                </p>
              </Alert>
            )}

            <p className="text-xs text-muted">{t('burnoutTrendSignals.whatThisIsNot')}</p>
            <p className="text-xs text-muted">{t('burnoutTrendSignals.informationalOnly')}</p>
          </>
        )}
      </div>
    </Card>
  )
}

export default BurnoutTrendSignals
