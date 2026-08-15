import { useTranslation } from 'react-i18next'
import { CATEGORY_LABELS } from '../../services/analyticsService'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { SkeletonList } from '../ui/Loading'

const ACTION_LABEL_DEFAULTS = {
  no_action: 'No action',
  coaching: 'Coaching',
  verbal_warning: 'Verbal warning',
  written_warning: 'Written warning',
  performance_improvement_plan: 'Performance improvement plan',
  suspension: 'Suspension',
  demotion: 'Demotion',
  termination: 'Termination',
}

const DEPARTMENT_TIER_LABEL_DEFAULTS = {
  junior: 'Junior',
  senior: 'Senior',
  manager: 'Manager',
  unspecified: 'Unspecified',
}

// The severity-band x action-taken grid for one department tier. Aggregate
// counts only, from companies/{companyId}/analytics/consistency's
// severityActionCounts - never a single case's score, and never shown at all
// for a tier whose case count fell below the reporting floor (that tier
// simply has no entry in `departments`, per aggregateCaseAnalytics.js).
function SeverityActionGrid({ severityActionCounts }) {
  const { t } = useTranslation()
  const bands = Object.keys(severityActionCounts)
  const actionsSeen = new Set()
  bands.forEach((band) => Object.keys(severityActionCounts[band]).forEach((a) => actionsSeen.add(a)))
  const actions = [...actionsSeen]

  if (actions.length === 0) {
    return <p className="text-xs text-muted">{t('consistencyInsights.noRankedActions')}</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 pr-3 font-medium">{t('consistencyInsights.severityBand')}</th>
            {actions.map((action) => (
              <th key={action} className="py-1 pr-3 font-medium">
                {t(`actionLabels.${action}`, { defaultValue: ACTION_LABEL_DEFAULTS[action] ?? action })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => (
            <tr key={band} className="border-t border-line-soft">
              <td className="py-1 pr-3 font-medium text-charcoal">{band}</td>
              {actions.map((action) => (
                <td key={action} className="py-1 pr-3 tabular-nums text-charcoal">
                  {severityActionCounts[band][action] ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CategorySection({ category, summary }) {
  const { t } = useTranslation()
  const label = t(`categories.${category}.label`, { defaultValue: CATEGORY_LABELS[category] ?? category })

  if (!summary || summary.status === 'insufficient_data') {
    return (
      <div className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-charcoal">{label}</span>
          <Badge tone="tone-neutral">{t('consistencyInsights.insufficientData')}</Badge>
        </div>
        <p className="text-xs text-muted">
          {t('consistencyInsights.insufficientDataBody', { count: summary?.referenceCaseCount ?? 0 })}
        </p>
      </div>
    )
  }

  const departmentEntries = Object.entries(summary.departments || {})

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-charcoal">{label}</span>
        <Badge tone="tone-low" dot>
          {t('consistencyInsights.closedCasesOnFile', { count: summary.referenceCaseCount })}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('consistencyInsights.consistent')}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-low">{summary.consistentCount}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('consistencyInsights.flaggedHarsher')}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-critical">{summary.harsherCount}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('consistencyInsights.flaggedLenient')}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-gold-600">{summary.lenientCount}</p>
        </div>
      </div>

      {departmentEntries.length === 0 ? (
        <p className="text-xs text-muted">{t('consistencyInsights.noDepartmentTier')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {departmentEntries.map(([tier, dept]) => (
            <div key={tier} className="rounded-lg border border-line-soft p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-charcoal">
                  {t('consistencyInsights.tierCases', {
                    tier: t(`departmentTierLabels.${tier}`, { defaultValue: DEPARTMENT_TIER_LABEL_DEFAULTS[tier] ?? tier }),
                    count: dept.caseCount,
                  })}
                </span>
                <span className="text-muted">
                  {t('consistencyInsights.typicalAction')}{' '}
                  <span className="text-charcoal">
                    {dept.typicalAction
                      ? t(`actionLabels.${dept.typicalAction}`, {
                          defaultValue: ACTION_LABEL_DEFAULTS[dept.typicalAction] ?? dept.typicalAction,
                        })
                      : '-'}
                  </span>
                </span>
              </div>
              <SeverityActionGrid severityActionCounts={dept.severityActionCounts} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Module 28's aggregate view of module 10's Consistency Engine: what used to
// be a per-case flag buried inside CaseDetailView, surfaced here as a
// company-wide summary - where the company's own historical pattern sits per
// category and department tier, and how many closed cases landed harsher,
// more lenient, or consistent with that pattern. Every number comes from
// companies/{companyId}/analytics/consistency, itself built only from
// referenceCases (module 10's existing metadata-only pool) scoped to this
// company - never cases/{caseId}, never a cross-company comparison.
function ConsistencyInsights({ data, loading }) {
  const { t } = useTranslation()
  if (loading) {
    return (
      <Card title={t('consistencyInsights.title')} description={t('consistencyInsights.loadingDescription')}>
        <SkeletonList rows={3} />
      </Card>
    )
  }

  const entries = Object.entries(data?.byCategory || {})

  return (
    <Card
      title={t('consistencyInsights.title')}
      description={t('consistencyInsights.description')}
    >
      {entries.length === 0 ? (
        <EmptyState
          compact
          icon="sparkle"
          title={t('consistencyInsights.empty.title')}
          description={t('consistencyInsights.empty.description')}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {entries.map(([category, summary]) => (
            <li key={category}>
              <CategorySection category={category} summary={summary} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default ConsistencyInsights
