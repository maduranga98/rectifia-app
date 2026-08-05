import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listCompanyCaseMetadata } from '../../services/caseMetadataService'
import { listCaseHandlers, reassignCase } from '../../services/routingService'
import { auth } from '../../services/firebase'
import { CATEGORIES } from '../../data/categories'
import {
  APPROACHING_DEADLINE_WINDOW_MS,
  deadlineDisplay,
  nextDeadlineMs,
} from '../../utils/caseDeadlines'
import CaseTriageModal from './CaseTriageModal'
import FollowUpStatus from './FollowUpStatus'
import PatternSignals from './PatternSignals'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import StatTile from '../ui/StatTile'
import { Select } from '../ui/Field'
import { SkeletonList, SkeletonStats } from '../ui/Loading'

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

const STATUS_OPTIONS = ['open', 'assigned', 'needs_manual_assignment', 'closed']
const PRIORITY_OPTIONS = ['high', 'medium', 'low']
const ASSIGNMENT_OPTIONS = ['assigned', 'unassigned']

// Lower rank sorts first, for the priority column.
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }
// Rough lifecycle order, so sorting by status groups the queue sensibly.
const STATUS_RANK = { needs_manual_assignment: 0, open: 1, assigned: 2, closed: 3 }

const PAGE_SIZE = 50

// The sortable columns and how each turns a row into a comparable value.
// Rows with no value (a missing score, no deadline) sort last in ascending
// order regardless of direction, so "unknown" never masquerades as "lowest".
const SORTERS = {
  severity: (c) => (typeof c.severityScore === 'number' ? c.severityScore : null),
  evidence: (c) => (typeof c.evidenceScore === 'number' ? c.evidenceScore : null),
  deadline: (c) => nextDeadlineMs(c),
  status: (c) => STATUS_RANK[c.status] ?? 99,
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

const categoryLabelById = new Map(CATEGORIES.map((c) => [c.id, c.label]))

// Escapes one CSV field per RFC 4180: wrap in quotes and double any embedded
// quote whenever the value contains a comma, quote, or newline. Everything is
// stringified first so a null or number can't slip through unescaped.
function csvField(value) {
  const str = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function toCsv(headerCells, rows) {
  return [headerCells, ...rows].map((cells) => cells.map(csvField).join(',')).join('\r\n')
}

function downloadCsv(filename, csv) {
  // A BOM so Excel opens UTF-8 correctly; a blob URL revoked right after the
  // click so nothing lingers.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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

// A column header that sorts the table. The active column shows its
// direction with an arrow; the others show a dimmed neutral marker so it reads
// as sortable without shouting. It's a real button for keyboard and screen
// reader users, with aria-sort announced on the cell wrapping it via the arrow.
function SortHeader({ label, columnKey, activeKey, dir, onSort }) {
  const active = columnKey === activeKey
  const arrow = !active ? '↕' : dir === 'asc' ? '▲' : '▼'
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className="flex items-center gap-1 font-[inherit] text-inherit"
      aria-label={`Sort by ${label}${active ? (dir === 'asc' ? ', ascending' : ', descending') : ''}`}
    >
      <span>{label}</span>
      <span className={active ? 'text-charcoal' : 'text-subtle'} aria-hidden="true">
        {arrow}
      </span>
    </button>
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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

  // Filters, sort, and page all live in the URL query string so a filtered
  // view is shareable by link and survives a refresh. Reading them straight
  // from searchParams (rather than mirroring into local state) keeps the URL
  // the single source of truth - a change to the query string is the change to
  // the view.
  const filters = {
    category: searchParams.get('category') ?? '',
    status: searchParams.get('status') ?? '',
    priority: searchParams.get('priority') ?? '',
    assignment: searchParams.get('assignment') ?? '',
  }
  const sortKey = SORTERS[searchParams.get('sort')] ? searchParams.get('sort') : 'deadline'
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
  const page = Math.max(0, Number.parseInt(searchParams.get('page') ?? '0', 10) || 0)

  // Merges query-string changes without dropping the params it doesn't touch.
  // Any filter/sort change resets the page (except an explicit page change),
  // so a narrowed result set never strands the reader on a now-empty page 4.
  const updateParams = useCallback(
    (changes, { resetPage = true } = {}) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          if (resetPage && !('page' in changes)) next.delete('page')
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  function setFilter(key, value) {
    updateParams({ [key]: value })
  }

  function toggleSort(key) {
    // Same column flips direction; a new column starts ascending.
    if (key === sortKey) {
      updateParams({ sort: key, dir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      updateParams({ sort: key, dir: 'asc' })
    }
  }

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (filters.category && c.category !== filters.category) return false
      if (filters.status && c.status !== filters.status) return false
      if (filters.priority && c.priority !== filters.priority) return false
      if (filters.assignment === 'assigned' && !c.assignedHandlerId) return false
      if (filters.assignment === 'unassigned' && c.assignedHandlerId) return false
      return true
    })
  }, [cases, filters.category, filters.status, filters.priority, filters.assignment])

  const sortedCases = useMemo(() => {
    const valueOf = SORTERS[sortKey]
    const dir = sortDir === 'desc' ? -1 : 1
    return [...filteredCases].sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
      // Null/absent always sinks to the bottom, regardless of direction.
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return (av - bv) * dir
    })
  }, [filteredCases, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sortedCases.length / PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pagedCases = sortedCases.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE)

  const anyFilterActive = Boolean(
    filters.category || filters.status || filters.priority || filters.assignment
  )

  function handleExportCsv() {
    // Metadata columns only - the exact columns of the data cells in the table
    // below (the Triage/Reassign action columns are controls, not data). This
    // mirrors the HR Coordinator's server-side restriction: no questionnaire
    // text, no thread content, nothing this role has no read path to anyway.
    // Exports the currently filtered+sorted view, not the raw set.
    const header = [
      'Category',
      'Priority',
      'Status',
      'Severity',
      'Evidence',
      'Assigned handler',
      'Next deadline',
    ]
    const rows = sortedCases.map((c) => [
      humanize(c.category) ?? 'Uncategorized',
      c.priority ?? '',
      humanize(c.status) ?? 'open',
      c.severityScore ?? '',
      c.evidenceScore ?? '',
      c.assignedHandlerId ? handlerNameById.get(c.assignedHandlerId) ?? c.assignedHandlerId : 'Unassigned',
      deadlineDisplay(nextDeadlineMs(c), now).label,
    ])
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`cases-${stamp}.csv`, toCsv(header, rows))
  }

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
        <div className="flex flex-wrap items-center gap-2">
          {/* HR Coordinators are usually the ones a report is phoned or
              walked in to, so the form is one click from the queue they
              already have open. Filing a case grants them nothing on it -
              it routes to a Case Handler like any other, and this role stays
              metadata-only afterwards. */}
          <Button icon="plus" variant="primary" onClick={() => navigate('/intake')}>
            File a report on someone&apos;s behalf
          </Button>
          <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
            Refresh
          </Button>
        </div>
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

      {/* Above the case table on purpose: a cluster is the thing a queue view
          cannot show you, since it lives across rows rather than in one. Still
          metadata only - patternSignals is its own collection, derived from
          the same mirror this dashboard already reads. */}
      <PatternSignals companyId={companyId} />

      {/* Retaliation follow-up rollup, from the same metadata mirror this
          dashboard already reads - counts and statuses only, no case content. */}
      {!firstLoad && <FollowUpStatus cases={cases} />}

      {firstLoad ? (
        <SkeletonList rows={5} />
      ) : (
        <Card
          title="All cases"
          description={
            anyFilterActive
              ? `${sortedCases.length} of ${cases.length} case${cases.length === 1 ? '' : 's'} match`
              : `${cases.length} case${cases.length === 1 ? '' : 's'}`
          }
          padded={false}
          actions={
            <Button
              icon="document"
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              disabled={sortedCases.length === 0}
            >
              Export CSV
            </Button>
          }
        >
          {cases.length === 0 ? (
            <EmptyState
              icon="cases"
              title="No cases for this company yet"
              description="Submitted reports appear here the moment they are routed."
            />
          ) : (
            <>
              {/* Filters compose - each narrows the set the others already
                  narrowed - and every one is mirrored in the URL, so this whole
                  bar is reconstructed from a shared link. */}
              <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-5 py-4">
                <Select
                  label="Category"
                  value={filters.category}
                  onChange={(e) => setFilter('category', e.target.value)}
                  className="min-w-[150px]"
                >
                  <option value="">All categories</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Status"
                  value={filters.status}
                  onChange={(e) => setFilter('status', e.target.value)}
                  className="min-w-[150px]"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Priority"
                  value={filters.priority}
                  onChange={(e) => setFilter('priority', e.target.value)}
                  className="min-w-[130px]"
                >
                  <option value="">All priorities</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {humanize(p)}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Assignment"
                  value={filters.assignment}
                  onChange={(e) => setFilter('assignment', e.target.value)}
                  className="min-w-[140px]"
                >
                  <option value="">All</option>
                  {ASSIGNMENT_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {humanize(a)}
                    </option>
                  ))}
                </Select>
                {anyFilterActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateParams({ category: '', status: '', priority: '', assignment: '' })
                    }
                  >
                    Clear filters
                  </Button>
                )}
              </div>

              {sortedCases.length === 0 ? (
                <EmptyState
                  icon="cases"
                  title="No cases match these filters"
                  description="Adjust or clear the filters above to see more."
                />
              ) : (
              <div className="overflow-x-auto">
              <table className="data-table min-w-[980px]">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Priority</th>
                    <th>
                      <SortHeader label="Status" columnKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>
                      <SortHeader label="Severity" columnKey="severity" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>
                      <SortHeader label="Evidence" columnKey="evidence" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>Assigned handler</th>
                    <th>
                      <SortHeader label="Next deadline" columnKey="deadline" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>Triage</th>
                    <th>Reassign</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCases.map((c) => {
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

              {pageCount > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-5 py-3">
                  <span className="text-xs text-muted">
                    Showing {clampedPage * PAGE_SIZE + 1}–
                    {Math.min((clampedPage + 1) * PAGE_SIZE, sortedCases.length)} of{' '}
                    {sortedCases.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="back"
                      disabled={clampedPage === 0}
                      onClick={() => updateParams({ page: String(clampedPage - 1) }, { resetPage: false })}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted">
                      Page {clampedPage + 1} of {pageCount}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="chevronRight"
                      disabled={clampedPage >= pageCount - 1}
                      onClick={() => updateParams({ page: String(clampedPage + 1) }, { resetPage: false })}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
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
