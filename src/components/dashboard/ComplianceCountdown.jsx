import { useEffect, useState } from 'react'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const ESCALATION_WINDOW_MS = 48 * HOUR_MS
const TICK_MS = 60_000

function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  return typeof value === 'number' ? value : new Date(value).getTime()
}

function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return 'Overdue'
  const days = Math.floor(msRemaining / DAY_MS)
  const hours = Math.floor((msRemaining % DAY_MS) / HOUR_MS)
  return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h remaining`
}

function urgencyStyle(msRemaining) {
  if (msRemaining <= 0) return 'border-red-300 bg-red-50 text-red-700'
  if (msRemaining <= ESCALATION_WINDOW_MS) return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-green-200 bg-green-50 text-green-700'
}

// A deadline that's already been actioned (acknowledgment sent, feedback
// given) is shown as done regardless of how much time is left - the
// countdown only matters for deadlines still pending.
function DeadlineRow({ label, dueAt, actionedAt, actionedLabel }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const dueMs = toMillis(dueAt)
  if (!dueMs) return null

  const actioned = Boolean(actionedAt)
  const msRemaining = dueMs - now

  return (
    <div
      className={`rounded border px-3 py-2 text-sm ${
        actioned ? 'border-gray-200 bg-gray-50 text-gray-500' : urgencyStyle(msRemaining)
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span>{actioned ? actionedLabel : formatCountdown(msRemaining)}</span>
      </div>
      <p className="mt-1 text-xs opacity-80">Due {new Date(dueMs).toLocaleString()}</p>
    </div>
  )
}

// Purely presentational - reads the deadlines already computed on the case
// doc by functions/src/compliance/scheduleDeadlines.js (module 11) and
// never computes one itself, so a jurisdiction rule change never requires a
// frontend change. caseData is whatever shape HandlerDashboard.jsx /
// CaseDetailView.jsx already fetched (via handlerService.js).
function ComplianceCountdown({ caseData }) {
  if (!caseData) return null

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-700">Compliance deadlines</h3>

      <DeadlineRow
        label="Acknowledgment"
        dueAt={caseData.acknowledgmentDueAt}
        actionedAt={caseData.acknowledgmentSentAt}
        actionedLabel="Sent"
      />
      <DeadlineRow
        label="Feedback to reporter"
        dueAt={caseData.feedbackDueAt}
        actionedAt={caseData.feedbackGivenAt}
        actionedLabel="Given"
      />

      {caseData.complianceRuleApplied && (
        <p className="text-xs text-gray-400">Rule applied: {caseData.complianceRuleApplied}</p>
      )}
    </div>
  )
}

export default ComplianceCountdown
