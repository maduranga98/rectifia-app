import { useCallback, useEffect, useMemo, useState } from 'react'
import { listCompanyCaseMetadata } from '../../services/caseMetadataService'
import { listCaseHandlers, reassignCase } from '../../services/routingService'
import { auth } from '../../services/firebase'
import CaseTriageModal from './CaseTriageModal'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import StatTile from '../ui/StatTile'
import { SkeletonList, SkeletonStats } from '../ui/Loading'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const APPROACHING_DEADLINE_WINDOW_MS = 48 * HOUR_MS

function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  return typeof value === 'number' ? value : new Date(value).getTime()
}

// The nearer of the two compliance deadlines (module 11) still pending on
// this case. Both deadlines already live on caseMetadata - this dashboard
// only ever reads that metadata-only mirror, never cases/{caseId} itself.
function nextDeadlineMs(caseRow) {
  const candidates = [toMillis(caseRow.acknowledgmentDueAt), toMillis(caseRow.feedbackDueAt)].filter(
    (ms) => ms !== null
  )
  if (candidates.length === 0) return null
  return Math.min(...candidates)
}

// A deadline is either past, inside the escalation window, or comfortable -
// and the cell should say which without the reader doing date arithmetic.
function deadlineDisplay(deadlineMs, now) {
  if (deadlineMs === null) return { label: '—', tone: 'tone-neutral' }
  const msRemaining = deadlineMs - now
  if (msRemaining <= 0) return { label: 'Overdue', tone: 'tone-critical' }
  const days = Math.ceil(msRemaining / DAY_MS)
  return {
    label: days === 1 ? '1 day' : `${days} days`,
    tone: msRemaining <= APPROACHING_DEADLINE_WINDOW_MS ? 'tone-high' : 'tone-low',
  }
}

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
}

const STATUS_TONE = {
  open: 'tone-neutral',
  assigned: 'tone-info',
  needs_manual_assignment: 'tone-high',
  closed: 'tone-low',
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

// Which rows offer "View". Triage is reading an unassigned case in order to
// place it, so the button appears only while there is nothing else to read
// it for: no handler yet, a status getCaseForTriage will still answer on,
// and not a conflict-of-interest case - those are the platform operator's,
// and the callable refuses this role outright. Gating the button here is
// presentation; the same three conditions are enforced server-side, so a
// row that slips through gets a permission-denied rather than a case.
const TRIAGE_STATUSES = ['open', 'needs_manual_assignment']

function isTriageable(caseRow) {
  return (
    !caseRow.assignedHandlerId &&
    TRIAGE_STATUSES.includes(caseRow.status) &&
    caseRow.routingReason !== 'conflict_of_interest'
  )
}

// Company-wide case table for the HR Coordinator role. Every column here -
// category, severityScore, evidenceScore, status, assignedHandler,
// daysUntilDeadline, priority - comes from caseMetadata/{caseId}, the
// metadata-only mirror module 13's Cloud Function maintains. This component
// never reads cases/{caseId} or messages/, and firestore.rules would deny it
// even if it tried - the restriction isn't just "this component doesn't
// render those fields", it's that this role has no server-side path to them.
function HRCoordinatorDashboard({ companyId }) {
  const [cases, setCases] = useState([])
  const [handlers, setHandlers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reassigningId, setReassigningId] = useState(null)
  const [triageCaseId, setTriageCaseId] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [caseRows, handlerRows] = await Promise.all([
        listCompanyCaseMetadata(companyId),
        listCaseHandlers(companyId),
      ])
      setCases(caseRows)
      setHandlers(handlerRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const handlerNameById = useMemo(() => {
    const map = new Map()
    handlers.forEach((h) => map.set(h.id, h.email ?? h.id))
    return map
  }, [handlers])

  // "now" is tracked as state (ticking every minute), the same approach
  // ComplianceCountdown.jsx uses, rather than calling Date.now() inside a
  // render-time computation - the count needs to be reactive to the passage
  // of time, not just to `cases` changing.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const approachingDeadlineCount = useMemo(
    () =>
      cases.filter((c) => {
        const deadlineMs = nextDeadlineMs(c)
        return deadlineMs !== null && deadlineMs - now <= APPROACHING_DEADLINE_WINDOW_MS
      }).length,
    [cases, now]
  )

  const openCount = cases.filter((c) => c.status !== 'closed').length
  const unassignedCount = cases.filter((c) => !c.assignedHandlerId).length

  async function handleReassign(caseId, handlerId) {
    if (!handlerId) return
    setReassigningId(caseId)
    setError(null)
    try {
      await reassignCase({ caseId, companyId, handlerId, actorId: auth.currentUser?.uid })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setReassigningId(null)
    }
  }

  const firstLoad = loading && cases.length === 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Every case in the company, by metadata only. Case content stays with the assigned
          handler.
        </p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
          Refresh
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {firstLoad ? (
        <SkeletonStats count={3} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Open cases" value={openCount} tone="tone-info" icon="cases" />
          <StatTile
            label="Deadline pressure"
            hint="Approaching or past a compliance deadline"
            value={approachingDeadlineCount}
            tone={approachingDeadlineCount > 0 ? 'tone-high' : 'tone-low'}
            icon="clock"
          />
          <StatTile
            label="Unassigned"
            value={unassignedCount}
            tone={unassignedCount > 0 ? 'tone-critical' : 'tone-neutral'}
            icon="alert"
          />
        </div>
      )}

      {firstLoad ? (
        <SkeletonList rows={5} />
      ) : (
        <Card
          title="All cases"
          description={`${cases.length} case${cases.length === 1 ? '' : 's'}`}
          padded={false}
        >
          {cases.length === 0 ? (
            <EmptyState
              icon="cases"
              title="No cases for this company yet"
              description="Submitted reports appear here the moment they are routed."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[980px]">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Severity</th>
                    <th>Evidence</th>
                    <th>Assigned handler</th>
                    <th>Next deadline</th>
                    <th>Triage</th>
                    <th>Reassign</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => {
                    const deadline = deadlineDisplay(nextDeadlineMs(c), now)
                    return (
                      <tr key={c.id}>
                        <td className="font-medium text-charcoal">
                          {humanize(c.category) ?? 'Uncategorized'}
                        </td>
                        <td>
                          {c.priority && (
                            <Badge tone={PRIORITY_TONE[c.priority] ?? 'tone-neutral'} dot>
                              {c.priority}
                            </Badge>
                          )}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[c.status] ?? 'tone-neutral'}>
                            {humanize(c.status) ?? 'open'}
                          </Badge>
                        </td>
                        <td className="tabular-nums text-muted">{c.severityScore ?? '—'}</td>
                        <td className="tabular-nums text-muted">{c.evidenceScore ?? '—'}</td>
                        <td className="text-muted">
                          {handlerNameById.get(c.assignedHandlerId) ?? (
                            <span className="text-critical">Unassigned</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={deadline.tone}>{deadline.label}</Badge>
                        </td>
                        <td>
                          {isTriageable(c) ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              icon="document"
                              onClick={() => setTriageCaseId(c.id)}
                            >
                              View
                            </Button>
                          ) : (
                            <span className="text-xs text-subtle">—</span>
                          )}
                        </td>
                        <td>
                          <select
                            aria-label={`Reassign case ${c.caseId ?? c.id}`}
                            className="field w-44 py-1 text-xs"
                            disabled={reassigningId === c.id}
                            defaultValue=""
                            onChange={(e) => handleReassign(c.id, e.target.value)}
                          >
                            <option value="" disabled>
                              {reassigningId === c.id ? 'Reassigning...' : 'Reassign to...'}
                            </option>
                            {handlers.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.email ?? h.id}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {triageCaseId && (
        <CaseTriageModal
          caseId={triageCaseId}
          companyId={companyId}
          onClose={() => setTriageCaseId(null)}
          onAssigned={refresh}
        />
      )}
    </div>
  )
}

export default HRCoordinatorDashboard
