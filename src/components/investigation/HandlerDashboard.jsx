import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAssignedCases } from '../../services/handlerService'
import { deadlineDisplay, nextDeadlineMs, toMillis } from '../../utils/caseDeadlines'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Select } from '../ui/Field'
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

// The sort control's options. 'default' is the triage order below; the other
// two are single-key orderings a handler can switch to. All three are applied
// client-side over the already-fetched list - no Firestore orderBy, no index.
const SORT_OPTION_VALUES = ['default', 'deadline', 'recent']

function formatTimestamp(value) {
  const ms = toMillis(value)
  return ms === null ? null : new Date(ms).toLocaleString()
}

// Closed cases need no action, so they sink to the bottom in every ordering -
// a handler is looking at their live queue, not a done pile, whichever sort
// they pick. Returns 0/1 so it can lead every comparator below.
function closedRank(caseRow) {
  return caseRow.status === 'closed' ? 1 : 0
}

// Most-recently-assigned first. A missing assignedAt sorts oldest (0) rather
// than newest, so an un-timestamped case never jumps the top of the list.
function assignedMs(caseRow) {
  return toMillis(caseRow.assignedAt) ?? 0
}

// Default triage order for a handler's own queue: the things that can't wait
// float to the top. Closed cases sink to the bottom regardless of anything
// else; among the rest, a crisis-flagged case outranks everything, then higher
// priority, then the nearest compliance deadline, and finally the most recently
// assigned case. A case with no deadline sorts last within its tier rather than
// first.
function byDefault(a, b) {
  const closed = closedRank(a) - closedRank(b)
  if (closed !== 0) return closed

  const crisis = (a.crisisFlag ? 0 : 1) - (b.crisisFlag ? 0 : 1)
  if (crisis !== 0) return crisis

  const priority = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
  if (priority !== 0) return priority

  const deadline = (nextDeadlineMs(a) ?? Infinity) - (nextDeadlineMs(b) ?? Infinity)
  if (deadline !== 0) return deadline

  return assignedMs(b) - assignedMs(a)
}

// Nearest pending deadline first; a case with no deadline sorts last.
function byDeadline(a, b) {
  const closed = closedRank(a) - closedRank(b)
  if (closed !== 0) return closed
  return (nextDeadlineMs(a) ?? Infinity) - (nextDeadlineMs(b) ?? Infinity)
}

// Most recently assigned first.
function byRecent(a, b) {
  const closed = closedRank(a) - closedRank(b)
  if (closed !== 0) return closed
  return assignedMs(b) - assignedMs(a)
}

const SORTERS = { default: byDefault, deadline: byDeadline, recent: byRecent }

function sortForHandler(cases, sortKey) {
  return [...cases].sort(SORTERS[sortKey] ?? byDefault)
}

// Lists only the cases assigned to the signed-in Case Handler. The
// filtering here is a courtesy, not the security boundary - listAssignedCases()
// queries Firestore with the handler's own auth uid, and firestore.rules
// rejects any case document whose assignedHandlerId doesn't match it, so
// this list can never include another handler's cases even read-only.
function HandlerDashboard({ onSelectCase }) {
  const { t } = useTranslation()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('default')

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

  const sortedCases = useMemo(() => sortForHandler(cases, sortKey), [cases, sortKey])
  const openCount = cases.filter((c) => c.status !== 'closed').length

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('handlerDashboard.openCasesAssigned', { count: openCount })}</p>
        {/* Filing a report on someone's behalf is now a nav entry
            (/dashboard/intake) rather than a button here, so it is reachable
            from every page rather than only this one. */}
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel={t('handlerDashboard.refreshing')}>
          {t('handlerDashboard.refresh')}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading && cases.length === 0 ? (
        <SkeletonList rows={3} />
      ) : cases.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="cases"
            title={t('handlerDashboard.empty.title')}
            description={t('handlerDashboard.empty.description')}
          />
        </Card>
      ) : (
        <>
          {/* Sorting is presentation only - it reorders the list already
              fetched, with no Firestore orderBy and no filtering (a handler's
              queue is their own assignments and short by construction). */}
          <div className="flex items-center justify-end">
            <Select
              label={t('handlerDashboard.sortBy')}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="w-56 py-1.5 text-sm"
            >
              {SORT_OPTION_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`handlerDashboard.sortOptions.${value}`)}
                </option>
              ))}
            </Select>
          </div>

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
                      {c.category
                        ? t(`categories.${c.category}.label`, { defaultValue: c.category.replace(/_/g, ' ') })
                        : t('handlerDashboard.uncategorized')}
                      {assignedAt && t('handlerDashboard.assignedAt', { date: assignedAt })}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {isCrisis && (
                      <Badge tone="tone-critical" icon="alert">
                        {t('handlerDashboard.crisisFlagged')}
                      </Badge>
                    )}
                    {c.priority === 'high' && !isCrisis && (
                      <Badge tone="tone-high" dot>
                        {t('handlerDashboard.highPriority')}
                      </Badge>
                    )}
                    <span className="hidden items-center gap-1 text-xs text-muted sm:flex">
                      <Icon name="clock" className="h-3.5 w-3.5" />
                      <Badge tone={deadline.tone}>{deadline.label}</Badge>
                    </span>
                    <Badge tone={STATUS_TONE[c.status] ?? STATUS_TONE.open}>
                      {t(`caseStatus.${c.status ?? 'open'}`, { defaultValue: (c.status ?? 'open').replace(/_/g, ' ') })}
                    </Badge>
                    <Icon name="chevronRight" className="h-4 w-4 text-subtle" />
                  </span>
                </button>
              </li>
            )
          })}
          </ul>
        </>
      )}
    </div>
  )
}

export default HandlerDashboard
