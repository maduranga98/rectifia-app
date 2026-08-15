// Compliance-deadline helpers shared by the two staff case lists
// (HRCoordinatorDashboard, HandlerDashboard). Extracted here rather than
// duplicated so the "how near is the next deadline, and how should that read"
// logic can never drift between the two dashboards. These operate on whatever
// deadline fields the caller already reads - caseMetadata for HR, the assigned
// case doc for a handler - and add no new data source of their own.

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const APPROACHING_DEADLINE_WINDOW_MS = 48 * HOUR_MS

export function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  return typeof value === 'number' ? value : new Date(value).getTime()
}

// The nearer of the two compliance deadlines (module 11) still on this case.
// Both fields are already present on whatever record the caller passes in;
// this reads them, it does not fetch anything.
export function nextDeadlineMs(caseRow) {
  const candidates = [
    toMillis(caseRow.acknowledgmentDueAt),
    toMillis(caseRow.feedbackDueAt),
  ].filter((ms) => ms !== null)
  if (candidates.length === 0) return null
  return Math.min(...candidates)
}

// A deadline is either past, inside the escalation window, or comfortable -
// and the cell should say which without the reader doing date arithmetic.
export function deadlineDisplay(deadlineMs, now) {
  if (deadlineMs === null) return { label: '-', tone: 'tone-neutral' }
  const msRemaining = deadlineMs - now
  if (msRemaining <= 0) return { label: 'Overdue', tone: 'tone-critical' }
  const days = Math.ceil(msRemaining / DAY_MS)
  return {
    label: days === 1 ? '1 day' : `${days} days`,
    tone: msRemaining <= APPROACHING_DEADLINE_WINDOW_MS ? 'tone-high' : 'tone-low',
  }
}
