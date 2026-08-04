import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCompanyStats } from '../../services/companyStatsService'
import { listRoutingRules, listStaff } from '../../services/routingService'
import { listPulseSummaries } from '../../services/pulseCheckService'
import { CATEGORIES } from '../../data/categories'

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

const categoryLabelById = new Map(CATEGORIES.map((c) => [c.id, c.label]))

function StatTile({ label, value, tone = 'tone-neutral' }) {
  return (
    <div className={`flex flex-col gap-1 rounded border px-4 py-3 ${tone}`}>
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-sm">{label}</span>
    </div>
  )
}

function BreakdownList({ title, entries, emptyLabel = 'Nothing to show.', labelFor = (key) => key, toneFor = () => 'tone-neutral' }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-line bg-surface px-4 py-3">
      <h3 className="text-sm font-semibold text-charcoal">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {entries.map(([key, count]) => (
            <li key={key} className="flex items-center justify-between">
              <span className={`rounded border px-2 py-0.5 text-xs ${toneFor(key)}`}>{labelFor(key)}</span>
              <span className="font-medium">{count}</span>
            </li>
          ))}
        </ul>
      )}
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

  if (loading && !stats) {
    return <p className="p-6 text-sm text-muted">Loading...</p>
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-charcoal">Overview</h2>
        <button type="button" onClick={refresh} className="text-sm text-navy underline">
          Refresh
        </button>
      </div>
      {error && <p className="text-sm text-critical">{error}</p>}

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Case overview</h3>
        {!stats ? (
          <p className="text-sm text-muted">No case activity yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Open cases" value={stats.openCount ?? 0} tone="tone-info" />
              <StatTile label="Closed cases" value={stats.closedCount ?? 0} tone="tone-neutral" />
              <StatTile
                label="Overdue deadlines"
                value={stats.overdueCount ?? 0}
                tone={stats.overdueCount > 0 ? 'tone-critical' : 'tone-neutral'}
              />
              <StatTile
                label="Approaching deadlines (48h)"
                value={stats.approachingDeadlineCount ?? 0}
                tone={stats.approachingDeadlineCount > 0 ? 'tone-high' : 'tone-neutral'}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <BreakdownList
                title="Open cases by priority"
                entries={priorityEntries}
                emptyLabel="No open cases."
                toneFor={(key) => PRIORITY_TONE[key] ?? 'tone-neutral'}
              />
              <BreakdownList
                title="Cases by category"
                entries={categoryEntries}
                emptyLabel="No cases yet."
                labelFor={(key) => categoryLabelById.get(key) ?? key}
              />
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Staff &amp; routing</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Active staff" value={activeStaffCount} tone="tone-info" />
          <StatTile label="Case handlers" value={caseHandlerCount} tone="tone-neutral" />
          <StatTile label="Routing rules configured" value={routingRules.length} tone="tone-neutral" />
        </div>
        <BreakdownList
          title="Open cases by handler"
          entries={handlerEntries}
          emptyLabel="No open cases assigned yet."
          labelFor={(key) => staffNameById.get(key) ?? key}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Pulse check sentiment</h3>
        {pulseSummaries.length === 0 ? (
          <p className="text-sm text-muted">No pulse check data yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pulseSummaries.map((s) => (
              <div key={s.id} className={`rounded border px-4 py-3 ${SENTIMENT_TONE(s.averageSentiment)}`}>
                <p className="font-medium">{s.department ?? 'Unspecified department'}</p>
                <p className="text-xs">{s.period}</p>
                <p className="mt-2 text-2xl font-semibold">{s.averageSentiment ?? '-'}</p>
                <p className="text-xs">avg. sentiment - {s.responseCount} response(s)</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default OverviewPage
