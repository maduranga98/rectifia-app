import { useCallback, useEffect, useState } from 'react'
import { listAssignedCases } from '../../services/handlerService'

const STATUS_STYLE = {
  open: 'border-line bg-canvas text-charcoal',
  assigned: 'tone-info',
  needs_manual_assignment: 'tone-high',
  closed: 'tone-low',
}

function formatTimestamp(value) {
  if (!value) return '-'
  const ms = typeof value.toMillis === 'function' ? value.toMillis() : value
  return new Date(ms).toLocaleString()
}

// Lists only the cases assigned to the signed-in Case Handler. The
// filtering here is a courtesy, not the security boundary - listAssignedCases()
// queries Firestore with the handler's own auth uid, and firestore.rules
// rejects any case document whose assignedHandlerId doesn't match it, so
// this list can never include another handler's cases even read-only.
function HandlerDashboard({ onSelectCase }) {
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listAssignedCases()
      setCases(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My cases</h1>
        <button type="button" onClick={refresh} className="text-sm text-navy underline">
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-critical">{error}</p>}
      {loading && cases.length === 0 && <p className="text-sm text-muted">Loading...</p>}
      {!loading && cases.length === 0 && !error && (
        <p className="text-sm text-muted">No cases are currently assigned to you.</p>
      )}

      <ul className="flex flex-col gap-3">
        {cases.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelectCase?.(c.id)}
              className="flex w-full items-center justify-between rounded border border-line bg-surface px-4 py-3 text-left hover:bg-canvas"
            >
              <div>
                <p className="font-medium">{c.caseId ?? c.id}</p>
                <p className="text-xs text-muted">{c.category ?? 'Uncategorized'}</p>
              </div>
              <div className="flex items-center gap-3">
                {c.priority === 'high' && (
                  <span className="tone-high rounded border px-2 py-0.5 text-xs">
                    High priority
                  </span>
                )}
                <span className={`rounded border px-2 py-0.5 text-xs ${STATUS_STYLE[c.status] ?? STATUS_STYLE.open}`}>
                  {c.status ?? 'open'}
                </span>
                <span className="text-xs text-muted">{formatTimestamp(c.assignedAt)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default HandlerDashboard
