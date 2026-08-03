import { useCallback, useEffect, useMemo, useState } from 'react'
import { listCompanyCaseMetadata } from '../../services/caseMetadataService'
import { listCaseHandlers, reassignCase } from '../../services/routingService'
import { auth } from '../../services/firebase'

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

function formatDaysUntilDeadline(deadlineMs, now) {
  if (deadlineMs === null) return '-'
  const msRemaining = deadlineMs - now
  if (msRemaining <= 0) return 'Overdue'
  return `${Math.ceil(msRemaining / DAY_MS)}d`
}

const PRIORITY_STYLE = {
  high: 'border-red-300 bg-red-50 text-red-700',
  medium: 'border-amber-300 bg-amber-50 text-amber-700',
  low: 'border-gray-200 bg-gray-50 text-gray-600',
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Company case overview</h1>
        <button type="button" onClick={refresh} className="text-sm text-blue-600 underline">
          Refresh
        </button>
      </div>

      <div
        className={`w-fit rounded border px-4 py-3 text-sm ${
          approachingDeadlineCount > 0 ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 bg-gray-50 text-gray-600'
        }`}
      >
        <span className="font-semibold">{approachingDeadlineCount}</span> case
        {approachingDeadlineCount === 1 ? '' : 's'} approaching or past a compliance deadline (within 48h)
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && cases.length === 0 && <p className="text-sm text-gray-500">Loading...</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Severity</th>
              <th className="py-2 pr-4">Evidence</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Assigned handler</th>
              <th className="py-2 pr-4">Days until deadline</th>
              <th className="py-2 pr-4">Priority</th>
              <th className="py-2 pr-4">Reassign</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-b border-gray-100">
                <td className="py-2 pr-4">{c.category ?? 'Uncategorized'}</td>
                <td className="py-2 pr-4">{c.severityScore ?? '-'}</td>
                <td className="py-2 pr-4">{c.evidenceScore ?? '-'}</td>
                <td className="py-2 pr-4">{c.status ?? '-'}</td>
                <td className="py-2 pr-4">{handlerNameById.get(c.assignedHandlerId) ?? '-'}</td>
                <td className="py-2 pr-4">{formatDaysUntilDeadline(nextDeadlineMs(c), now)}</td>
                <td className="py-2 pr-4">
                  {c.priority && (
                    <span className={`rounded border px-2 py-0.5 text-xs ${PRIORITY_STYLE[c.priority] ?? PRIORITY_STYLE.low}`}>
                      {c.priority}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <select
                    className="rounded border border-gray-300 px-2 py-1 text-xs"
                    disabled={reassigningId === c.id}
                    defaultValue=""
                    onChange={(e) => handleReassign(c.id, e.target.value)}
                  >
                    <option value="" disabled>
                      Reassign to...
                    </option>
                    {handlers.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.email ?? h.id}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && cases.length === 0 && !error && (
          <p className="py-4 text-sm text-gray-500">No cases for this company yet.</p>
        )}
      </div>
    </div>
  )
}

export default HRCoordinatorDashboard
