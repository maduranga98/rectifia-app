import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listAssignedCases } from '../../services/handlerService'
import { deadlineDisplay, nextDeadlineMs } from '../../utils/caseDeadlines'
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

// Lower rank sorts first. Anything without a priority sorts after low.
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

function formatTimestamp(value) {
  if (!value) return null
  const ms = typeof value.toMillis === 'function' ? value.toMillis() : value
  return new Date(ms).toLocaleString()
}

// Default triage order for a handler's own queue: the things that can't wait
// float to the top. Closed cases sink to the bottom regardless of anything
// else (they need no action); among the rest, a crisis-flagged case outranks
// everything, then higher priority, then the nearest compliance deadline. A
// case with no deadline sorts last within its tier rather than first.
function sortForHandler(cases) {
  return [...cases].sort((a, b) => {
    const aClosed = a.status === 'closed' ? 1 : 0
    const bClosed = b.status === 'closed' ? 1 : 0
    if (aClosed !== bClosed) return aClosed - bClosed

    const aCrisis = a.crisisFlag ? 0 : 1
    const bCrisis = b.crisisFlag ? 0 : 1
    if (aCrisis !== bCrisis) return aCrisis - bCrisis

    const aPriority = PRIORITY_RANK[a.priority] ?? 3
    const bPriority = PRIORITY_RANK[b.priority] ?? 3
    if (aPriority !== bPriority) return aPriority - bPriority

    return (nextDeadlineMs(a) ?? Infinity) - (nextDeadlineMs(b) ?? Infinity)
  })
}

// Lists only the cases assigned to the signed-in Case Handler. The
// filtering here is a courtesy, not the security boundary - listAssignedCases()
// queries Firestore with the handler's own auth uid, and firestore.rules
// rejects any case document whose assignedHandlerId doesn't match it, so
// this list can never include another handler's cases even read-only.
function HandlerDashboard({ onSelectCase }) {
  const navigate = useNavigate()
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

  // Ticks every minute so the deadline labels stay accurate without a reload,
  // the same approach the HR dashboard and ComplianceCountdown use.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const sortedCases = useMemo(() => sortForHandler(cases), [cases])
  const openCount = cases.filter((c) => c.status !== 'closed').length

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {openCount} open case{openCount === 1 ? '' : 's'} assigned to you.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* A handler who has just taken a report by phone is standing at
              this screen, not hunting through a menu for the form. */}
          <Button icon="plus" variant="primary" onClick={() => navigate('/intake')}>
            File a report on someone&apos;s behalf
          </Button>
          <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
            Refresh
          </Button>
        </div>
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
          {sortedCases.map((c) => {
            const assignedAt = formatTimestamp(c.assignedAt)
            const isCrisis = Boolean(c.crisisFlag)
            const deadline = deadlineDisplay(nextDeadlineMs(c), now)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelectCase?.(c.id)}
                  // A crisis-flagged case is not just another badge in the row -
                  // it gets its own treatment: a critical left rail and a tinted
                  // surface so it reads as different at a glance, before any
                  // label is parsed.
                  className={`card relative flex w-full items-center gap-4 overflow-hidden px-5 py-4 text-left transition-shadow hover:shadow-[var(--shadow-raised)] ${
                    isCrisis ? 'border-critical/40 bg-critical/[0.04] pl-6' : ''
                  }`}
                >
                  {isCrisis && (
                    <span
                      className="absolute inset-y-0 left-0 w-1.5 bg-critical"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      isCrisis ? 'bg-critical/10 text-critical' : 'bg-navy-50 text-navy'
                    }`}
                    aria-hidden="true"
                  >
                    <Icon name={isCrisis ? 'alert' : 'document'} className="h-5 w-5" />
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
                    {isCrisis && (
                      <Badge tone="tone-critical" icon="alert">
                        Crisis flagged
                      </Badge>
                    )}
                    {c.priority === 'high' && !isCrisis && (
                      <Badge tone="tone-high" dot>
                        High priority
                      </Badge>
                    )}
                    <span className="hidden items-center gap-1 text-xs text-muted sm:flex">
                      <Icon name="clock" className="h-3.5 w-3.5" />
                      <Badge tone={deadline.tone}>{deadline.label}</Badge>
                    </span>
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
