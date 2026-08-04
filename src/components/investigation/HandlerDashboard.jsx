import { useCallback, useEffect, useState } from 'react'
import { listAssignedCases } from '../../services/handlerService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import Icon from '../ui/Icon'
import { SkeletonList } from '../ui/Loading'

const STATUS_TONE = {
  open: 'tone-neutral',
  assigned: 'tone-info',
  needs_manual_assignment: 'tone-high',
  closed: 'tone-low',
}

function formatTimestamp(value) {
  if (!value) return null
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

  const openCount = cases.filter((c) => c.status !== 'closed').length

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {openCount} open case{openCount === 1 ? '' : 's'} assigned to you.
        </p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
          Refresh
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading && cases.length === 0 ? (
        <SkeletonList rows={3} />
      ) : cases.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="cases"
            title="No cases assigned to you"
            description="New cases arrive here automatically when a routing rule sends one your way."
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {cases.map((c) => {
            const assignedAt = formatTimestamp(c.assignedAt)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectCase?.(c.id)}
                  className="card flex w-full items-center gap-4 px-5 py-4 text-left transition-shadow hover:shadow-[var(--shadow-raised)]"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy"
                    aria-hidden="true"
                  >
                    <Icon name="document" className="h-5 w-5" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-charcoal">
                      {c.caseId ?? c.id}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {(c.category ?? 'Uncategorized').replace(/_/g, ' ')}
                      {assignedAt && ` · assigned ${assignedAt}`}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {c.priority === 'high' && (
                      <Badge tone="tone-high" dot>
                        High priority
                      </Badge>
                    )}
                    <Badge tone={STATUS_TONE[c.status] ?? STATUS_TONE.open}>
                      {(c.status ?? 'open').replace(/_/g, ' ')}
                    </Badge>
                    <Icon name="chevronRight" className="h-4 w-4 text-subtle" />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default HandlerDashboard
