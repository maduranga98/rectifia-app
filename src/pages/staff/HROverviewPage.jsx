import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  APPROACHING_DEADLINE_WINDOW_MS,
  nextDeadlineMs,
} from '../../utils/caseDeadlines'
import { useNow } from '../../hooks/useCaseTable'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import StatTile from '../../components/ui/StatTile'
import { SkeletonStats } from '../../components/ui/Loading'

// The HR Coordinator's landing page: the three headline counts, plus a short
// compliance summary. Every number here is derived from the shared
// caseMetadata read (useCompanyCases) - it issues no query of its own, so
// landing here after the All cases page is instant. Metadata only: counts and
// deadlines, never case content.
function HROverviewPage({ cases, loading, error, refresh }) {
  const { t } = useTranslation()
  const now = useNow()

  const openCount = cases.filter((c) => c.status !== 'closed').length
  const unassignedCount = cases.filter((c) => !c.assignedHandlerId).length

  const { approachingCount, overdueCount } = useMemo(() => {
    let approaching = 0
    let overdue = 0
    for (const c of cases) {
      const deadlineMs = nextDeadlineMs(c)
      if (deadlineMs === null) continue
      if (deadlineMs - now <= 0) overdue += 1
      else if (deadlineMs - now <= APPROACHING_DEADLINE_WINDOW_MS) approaching += 1
    }
    return { approachingCount: approaching, overdueCount: overdue }
  }, [cases, now])

  const deadlinePressure = approachingCount + overdueCount
  const firstLoad = loading && cases.length === 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">{t('hrOverviewPage.description')}</p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel={t('hrCasesPage.refreshing')}>
          {t('hrCasesPage.refresh')}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {firstLoad ? (
        <SkeletonStats count={3} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label={t('hrOverviewPage.openCases')} value={openCount} tone="tone-info" icon="cases" />
            <StatTile
              label={t('hrOverviewPage.deadlinePressure')}
              hint={t('hrOverviewPage.deadlinePressureHint')}
              value={deadlinePressure}
              tone={deadlinePressure > 0 ? 'tone-high' : 'tone-low'}
              icon="clock"
            />
            <StatTile
              label={t('hrOverviewPage.unassigned')}
              value={unassignedCount}
              tone={unassignedCount > 0 ? 'tone-critical' : 'tone-neutral'}
              icon="alert"
            />
          </div>

          <Card title={t('hrOverviewPage.complianceSummary.title')} description={t('hrOverviewPage.complianceSummary.description')}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <p className="text-3xl font-semibold tabular-nums text-charcoal">{overdueCount}</p>
                <p className="text-sm text-muted">{t('hrOverviewPage.overdue')}</p>
              </div>
              <div>
                <p className="text-3xl font-semibold tabular-nums text-charcoal">{approachingCount}</p>
                <p className="text-sm text-muted">{t('hrOverviewPage.dueWithin48h')}</p>
              </div>
              <div>
                <p className="text-3xl font-semibold tabular-nums text-charcoal">{openCount}</p>
                <p className="text-sm text-muted">{t('hrOverviewPage.openCases')}</p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

export default HROverviewPage
