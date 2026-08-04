import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCompanyStats } from '../../services/companyStatsService'
import { listRoutingRules, listStaff } from '../../services/routingService'
import { listPulseSummaries } from '../../services/pulseCheckService'
import { CATEGORIES } from '../../data/categories'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import StatTile from '../../components/ui/StatTile'
import { SkeletonList, SkeletonStats } from '../../components/ui/Loading'

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
}

const SENTIMENT_TONE = (score) => {
  if (score === null || score === undefined) return 'tone-neutral'
  if (score < 40) return 'tone-critical'
  if (score < 60) return 'tone-medium'
  return 'tone-low'
}

// The band the average falls in, said in words. The number alone doesn't
// tell a reader whether 58 is good; the badge does, and it uses the same
// thresholds as the colour so the two can never disagree.
const SENTIMENT_LABEL = (score) => {
  if (score === null || score === undefined) return 'no data'
  if (score < 40) return 'needs attention'
  if (score < 60) return 'mixed'
  return 'healthy'
}

const categoryLabelById = new Map(CATEGORIES.map((c) => [c.id, c.label]))

// A labelled count list rendered as a proportional bar rather than a
// label/number pair. With counts this small the bar is what makes the
// distribution readable at a glance - "12 vs 3" lands slower than two bars
// of visibly different length.
function BreakdownList({ entries, labelFor = (key) => key, toneFor = () => 'tone-neutral' }) {
  const max = Math.max(...entries.map(([, count]) => count), 1)

  return (
    <ul className="flex flex-col gap-3">
      {entries.map(([key, count]) => (
        <li key={key} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <Badge tone={toneFor(key)} dot>
              {labelFor(key)}
            </Badge>
            <span className="text-sm font-semibold tabular-nums text-charcoal">{count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-navy transition-[width] duration-500"
              style={{ width: `${Math.round((count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function SectionHeading({ children, hint }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  )
}

// Company Admin's overview (module 15). Three data sources, each already
// scoped to what this role is allowed to see per firestore.rules:
// - companies/{companyId}/stats/overview - count-only case rollup, no case
//   ids or content (functions/src/company/syncCompanyStats.js).
// - companies/{companyId}/staff and routingRules - settings this role already
//   owned before this page existed.
// - pulseSummaries - department/period aggregates with no individual
//   attribution, the same collection the Manager role reads; this role has
//   no path to the underlying pulseResponses.
// Still no read path anywhere here to cases/, messages/, or caseMetadata/.
function OverviewPage({ companyId }) {
  const [stats, setStats] = useState(null)
  const [staff, setStaff] = useState([])
  const [routingRules, setRoutingRules] = useState([])
  const [pulseSummaries, setPulseSummaries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRow, staffRows, routingRows, pulseRows] = await Promise.all([
        getCompanyStats(companyId),
        listStaff(companyId),
        listRoutingRules(companyId),
        listPulseSummaries(companyId),
      ])
      setStats(statsRow)
      setStaff(staffRows)
      setRoutingRules(routingRows)
      setPulseSummaries(pulseRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const staffNameById = useMemo(() => {
    const map = new Map()
    staff.forEach((s) => map.set(s.id, s.email ?? s.id))
    return map
  }, [staff])

  const activeStaffCount = staff.filter((s) => (s.status ?? 'active') !== 'suspended').length
  const caseHandlerCount = staff.filter((s) => s.role === 'caseHandler').length

  const priorityEntries = Object.entries(stats?.byPriority ?? {}).sort(([, a], [, b]) => b - a)
  const categoryEntries = Object.entries(stats?.byCategory ?? {}).sort(([, a], [, b]) => b - a)
  const handlerEntries = Object.entries(stats?.byHandler ?? {}).sort(([, a], [, b]) => b - a)

  const firstLoad = loading && !stats && staff.length === 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Aggregate case activity, staffing, and wellbeing signals for your company. Case
          content itself is never shown to this role - only counts.
        </p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
          Refresh
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <section className="flex flex-col gap-3">
        <SectionHeading hint="Counts only, updated as cases move through their lifecycle.">
          Case overview
        </SectionHeading>

        {firstLoad ? (
          <SkeletonStats />
        ) : !stats ? (
          <Card padded={false}>
            <EmptyState
              icon="cases"
              title="No case activity yet"
              description="Once the first report is submitted, open, closed, and overdue counts appear here."
            />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Open cases" value={stats.openCount ?? 0} tone="tone-info" icon="cases" />
              <StatTile label="Closed cases" value={stats.closedCount ?? 0} tone="tone-neutral" icon="check" />
              <StatTile
                label="Overdue deadlines"
                value={stats.overdueCount ?? 0}
                tone={stats.overdueCount > 0 ? 'tone-critical' : 'tone-neutral'}
                icon="alert"
              />
              <StatTile
                label="Approaching deadlines"
                hint="Due within 48 hours"
                value={stats.approachingDeadlineCount ?? 0}
                tone={stats.approachingDeadlineCount > 0 ? 'tone-high' : 'tone-neutral'}
                icon="clock"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Open cases by priority">
                {priorityEntries.length === 0 ? (
                  <p className="text-sm text-muted">No open cases.</p>
                ) : (
                  <BreakdownList
                    entries={priorityEntries}
                    toneFor={(key) => PRIORITY_TONE[key] ?? 'tone-neutral'}
                  />
                )}
              </Card>
              <Card title="Cases by category">
                {categoryEntries.length === 0 ? (
                  <p className="text-sm text-muted">No cases yet.</p>
                ) : (
                  <BreakdownList
                    entries={categoryEntries}
                    labelFor={(key) => categoryLabelById.get(key) ?? key}
                  />
                )}
              </Card>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading hint="Who is available to take cases, and how they get assigned.">
          Staff &amp; routing
        </SectionHeading>

        {firstLoad ? (
          <SkeletonStats count={3} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Active staff" value={activeStaffCount} tone="tone-info" icon="staff" />
              <StatTile label="Case handlers" value={caseHandlerCount} tone="tone-neutral" icon="shield" />
              <StatTile
                label="Routing rules"
                hint="Category and department mappings"
                value={routingRules.length}
                tone={routingRules.length === 0 ? 'tone-high' : 'tone-neutral'}
                icon="routing"
              />
            </div>

            <Card title="Open cases by handler" padded={handlerEntries.length > 0}>
              {handlerEntries.length === 0 ? (
                <EmptyState
                  compact
                  icon="staff"
                  title="No open cases assigned"
                  description="Assigned workload per handler shows up here as cases come in."
                />
              ) : (
                <BreakdownList
                  entries={handlerEntries}
                  labelFor={(key) => staffNameById.get(key) ?? key}
                />
              )}
            </Card>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading hint="Department and period averages - never an individual response.">
          Pulse check sentiment
        </SectionHeading>

        {firstLoad ? (
          <SkeletonList rows={2} />
        ) : pulseSummaries.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon="pulse"
              title="No pulse check data yet"
              description="Department sentiment averages appear here once employees start submitting pulse checks."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pulseSummaries.map((s) => (
              <Card key={s.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-charcoal">
                      {s.department ?? 'Unspecified department'}
                    </p>
                    <p className="text-xs text-muted">{s.period}</p>
                  </div>
                  <Badge tone={SENTIMENT_TONE(s.averageSentiment)} dot>
                    {SENTIMENT_LABEL(s.averageSentiment)}
                  </Badge>
                </div>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-charcoal">
                  {s.averageSentiment ?? '-'}
                </p>
                <p className="text-xs text-muted">
                  avg. sentiment across {s.responseCount} response{s.responseCount === 1 ? '' : 's'}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default OverviewPage
