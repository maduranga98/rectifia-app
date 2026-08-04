import { useCallback, useEffect, useState } from 'react'
import { getCompanyStats } from '../../services/companyStatsService'
import { CATEGORIES } from '../../data/categories'

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
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

function BreakdownList({ title, entries, labelFor = (key) => key, toneFor = () => 'tone-neutral' }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-line bg-surface px-4 py-3">
      <h3 className="text-sm font-semibold text-charcoal">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">No open cases.</p>
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

// Company Admin's case-derived overview (module 15). The only case data this
// role can see, by design: aggregate counts from companies/{companyId}/stats/
// overview, a rollup functions/src/company/syncCompanyStats.js maintains from
// caseMetadata. No case ids, no case content - firestore.rules doesn't grant
// this role a path to caseMetadata/, cases/, or messages/ even if this page
// tried to read them.
function OverviewPage({ companyId }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStats(await getCompanyStats(companyId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  if (loading && !stats) {
    return <p className="p-6 text-sm text-muted">Loading...</p>
  }

  if (!stats) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        {error && <p className="text-sm text-critical">{error}</p>}
        <p className="text-sm text-muted">No case activity yet.</p>
      </div>
    )
  }

  const priorityEntries = Object.entries(stats.byPriority ?? {}).sort(([, a], [, b]) => b - a)
  const categoryEntries = Object.entries(stats.byCategory ?? {}).sort(([, a], [, b]) => b - a)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-charcoal">Case overview</h2>
        <button type="button" onClick={refresh} className="text-sm text-navy underline">
          Refresh
        </button>
      </div>
      {error && <p className="text-sm text-critical">{error}</p>}

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
          toneFor={(key) => PRIORITY_TONE[key] ?? 'tone-neutral'}
        />
        <BreakdownList
          title="Cases by category"
          entries={categoryEntries}
          labelFor={(key) => categoryLabelById.get(key) ?? key}
        />
      </div>
    </div>
  )
}

export default OverviewPage
