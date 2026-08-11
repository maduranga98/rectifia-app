import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { CATEGORIES } from '../../data/categories'
import { deadlineDisplay, nextDeadlineMs } from '../../utils/caseDeadlines'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Select } from '../ui/Field'

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

// A column header that sorts the table. The active column shows its
// direction with an arrow; the others show a dimmed neutral marker so it reads
// as sortable without shouting. It's a real button for keyboard and screen
// reader users, with aria-sort announced on the cell wrapping it via the arrow.
function SortHeader({ label, columnKey, activeKey, dir, onSort }) {
  const { t } = useTranslation()
  const active = columnKey === activeKey
  const arrow = !active ? '↕' : dir === 'asc' ? '▲' : '▼'
  return (
    <button
      type="button"
      onClick={() => onSort(columnKey)}
      className="flex items-center gap-1 font-[inherit] text-inherit"
      aria-label={
        active
          ? t('casesTable.sortByDirection', { label, direction: dir === 'asc' ? t('casesTable.ascending') : t('casesTable.descending') })
          : t('casesTable.sortBy', { label })
      }
    >
      <span>{label}</span>
      <span className={active ? 'text-charcoal' : 'text-subtle'} aria-hidden="true">
        {arrow}
      </span>
    </button>
  )
}

// The company-wide case table, extracted from HRCoordinatorDashboard so the
// All cases and Awaiting triage pages render the exact same table over a
// different row set rather than each carrying its own copy. Every column here -
// category, severityScore, evidenceScore, status, assignedHandler,
// daysUntilDeadline, priority - comes from caseMetadata/{caseId}, the
// metadata-only mirror; this never reads cases/{caseId} or messages/, and the
// export mirrors that (metadata columns only).
//
// `prefilter` narrows the incoming rows before any of the user filters run (the
// Awaiting triage page passes isTriageable). `showTriageColumn` adds the "View"
// action that opens CaseTriageModal - shown only on the triage page, because
// triage is a distinct job, not a column button hanging off every row.
function CasesTable({
  cases,
  handlers,
  now,
  prefilter,
  showTriageColumn = false,
  onTriage,
  onReassign,
  reassigningId,
}) {
  const { t } = useTranslation()
  const statusLabel = (status) => t(`caseStatus.${status}`, { defaultValue: humanize(status) })
  const priorityLabel = (priority) => t(`priorityLabels.${priority}`, { defaultValue: humanize(priority) })
  const assignmentLabel = (value) => t(`assignmentLabels.${value}`, { defaultValue: humanize(value) })
  const [searchParams, setSearchParams] = useSearchParams()

  const handlerNameById = useMemo(() => {
    const map = new Map()
    handlers.forEach((h) => map.set(h.id, h.email ?? h.id))
    return map
  }, [handlers])

  const baseCases = useMemo(
    () => (prefilter ? cases.filter(prefilter) : cases),
    [cases, prefilter]
  )

  // Filters, sort, and page all live in the URL query string so a filtered
  // view is shareable by link and survives a refresh.
  const filters = {
    category: searchParams.get('category') ?? '',
    status: searchParams.get('status') ?? '',
    priority: searchParams.get('priority') ?? '',
    assignment: searchParams.get('assignment') ?? '',
  }
  const sortKey = SORTERS[searchParams.get('sort')] ? searchParams.get('sort') : 'deadline'
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
  const page = Math.max(0, Number.parseInt(searchParams.get('page') ?? '0', 10) || 0)

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
    if (key === sortKey) {
      updateParams({ sort: key, dir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      updateParams({ sort: key, dir: 'asc' })
    }
  }

  const filteredCases = useMemo(() => {
    return baseCases.filter((c) => {
      if (filters.category && c.category !== filters.category) return false
      if (filters.status && c.status !== filters.status) return false
      if (filters.priority && c.priority !== filters.priority) return false
      if (filters.assignment === 'assigned' && !c.assignedHandlerId) return false
      if (filters.assignment === 'unassigned' && c.assignedHandlerId) return false
      return true
    })
  }, [baseCases, filters.category, filters.status, filters.priority, filters.assignment])

  const sortedCases = useMemo(() => {
    const valueOf = SORTERS[sortKey]
    const dir = sortDir === 'desc' ? -1 : 1
    return [...filteredCases].sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
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
    const header = [
      t('casesTable.headers.category'),
      t('casesTable.headers.priority'),
      t('casesTable.headers.status'),
      t('casesTable.headers.severity'),
      t('casesTable.headers.evidence'),
      t('casesTable.headers.assignedHandler'),
      t('casesTable.headers.nextDeadline'),
    ]
    const rows = sortedCases.map((c) => [
      c.category
        ? t(`categories.${c.category}.label`, { defaultValue: humanize(c.category) })
        : t('casesTable.uncategorized'),
      c.priority ? priorityLabel(c.priority) : '',
      statusLabel(c.status) ?? t('casesTable.open'),
      c.severityScore ?? '',
      c.evidenceScore ?? '',
      c.assignedHandlerId
        ? handlerNameById.get(c.assignedHandlerId) ?? c.assignedHandlerId
        : t('casesTable.unassigned'),
      deadlineDisplay(nextDeadlineMs(c), now).label,
    ])
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`cases-${stamp}.csv`, toCsv(header, rows))
  }

  return (
    <Card
      title={t('casesTable.title')}
      description={
        anyFilterActive
          ? t('casesTable.matchCount', { matched: sortedCases.length, total: baseCases.length })
          : t('casesTable.caseCount', { count: baseCases.length })
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
          {t('casesTable.exportCsv')}
        </Button>
      }
    >
      {baseCases.length === 0 ? (
        <EmptyState
          icon="cases"
          title={t('casesTable.empty.title')}
          description={t('casesTable.empty.description')}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-5 py-4">
            <Select
              label={t('casesTable.filters.category')}
              value={filters.category}
              onChange={(e) => setFilter('category', e.target.value)}
              className="min-w-[150px]"
            >
              <option value="">{t('casesTable.filters.allCategories')}</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {t(`categories.${cat.id}.label`, { defaultValue: cat.label })}
                </option>
              ))}
            </Select>
            <Select
              label={t('casesTable.filters.status')}
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              className="min-w-[150px]"
            >
              <option value="">{t('casesTable.filters.allStatuses')}</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
            <Select
              label={t('casesTable.filters.priority')}
              value={filters.priority}
              onChange={(e) => setFilter('priority', e.target.value)}
              className="min-w-[130px]"
            >
              <option value="">{t('casesTable.filters.allPriorities')}</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {priorityLabel(p)}
                </option>
              ))}
            </Select>
            <Select
              label={t('casesTable.filters.assignment')}
              value={filters.assignment}
              onChange={(e) => setFilter('assignment', e.target.value)}
              className="min-w-[140px]"
            >
              <option value="">{t('casesTable.filters.all')}</option>
              {ASSIGNMENT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {assignmentLabel(a)}
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
                {t('casesTable.clearFilters')}
              </Button>
            )}
          </div>

          {sortedCases.length === 0 ? (
            <EmptyState
              icon="cases"
              title={t('casesTable.noMatch.title')}
              description={t('casesTable.noMatch.description')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[980px]">
                <thead>
                  <tr>
                    <th>{t('casesTable.headers.category')}</th>
                    <th>{t('casesTable.headers.priority')}</th>
                    <th>
                      <SortHeader label={t('casesTable.headers.status')} columnKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>
                      <SortHeader label={t('casesTable.headers.severity')} columnKey="severity" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>
                      <SortHeader label={t('casesTable.headers.evidence')} columnKey="evidence" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    <th>{t('casesTable.headers.assignedHandler')}</th>
                    <th>
                      <SortHeader label={t('casesTable.headers.nextDeadline')} columnKey="deadline" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    </th>
                    {showTriageColumn && <th>{t('casesTable.headers.triage')}</th>}
                    <th>{t('casesTable.headers.reassign')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedCases.map((c) => {
                    const deadline = deadlineDisplay(nextDeadlineMs(c), now)
                    return (
                      <tr key={c.id}>
                        <td className="font-medium text-charcoal">
                          {c.category
                            ? t(`categories.${c.category}.label`, { defaultValue: humanize(c.category) })
                            : t('casesTable.uncategorized')}
                        </td>
                        <td>
                          {c.priority && (
                            <Badge tone={PRIORITY_TONE[c.priority] ?? 'tone-neutral'} dot>
                              {priorityLabel(c.priority)}
                            </Badge>
                          )}
                        </td>
                        <td>
                          <Badge tone={STATUS_TONE[c.status] ?? 'tone-neutral'}>
                            {statusLabel(c.status) ?? t('casesTable.open')}
                          </Badge>
                        </td>
                        <td className="tabular-nums text-muted">{c.severityScore ?? '—'}</td>
                        <td className="tabular-nums text-muted">{c.evidenceScore ?? '—'}</td>
                        <td className="text-muted">
                          {handlerNameById.get(c.assignedHandlerId) ?? (
                            <span className="text-critical">{t('casesTable.unassigned')}</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={deadline.tone}>{deadline.label}</Badge>
                        </td>
                        {showTriageColumn && (
                          <td>
                            <Button
                              variant="secondary"
                              size="sm"
                              icon="document"
                              onClick={() => onTriage?.(c.id)}
                            >
                              {t('casesTable.view')}
                            </Button>
                          </td>
                        )}
                        <td>
                          <select
                            aria-label={t('casesTable.reassignAriaLabel', { caseId: c.caseId ?? c.id })}
                            className="field w-44 py-1 text-xs"
                            disabled={reassigningId === c.id}
                            defaultValue=""
                            onChange={(e) => onReassign?.(c.id, e.target.value)}
                          >
                            <option value="" disabled>
                              {reassigningId === c.id ? t('casesTable.reassigning') : t('casesTable.reassignTo')}
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
                {t('casesTable.showingRange', {
                  from: clampedPage * PAGE_SIZE + 1,
                  to: Math.min((clampedPage + 1) * PAGE_SIZE, sortedCases.length),
                  total: sortedCases.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="back"
                  disabled={clampedPage === 0}
                  onClick={() => updateParams({ page: String(clampedPage - 1) }, { resetPage: false })}
                >
                  {t('casesTable.previous')}
                </Button>
                <span className="text-xs text-muted">
                  {t('casesTable.pageOf', { page: clampedPage + 1, total: pageCount })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="chevronRight"
                  disabled={clampedPage >= pageCount - 1}
                  onClick={() => updateParams({ page: String(clampedPage + 1) }, { resetPage: false })}
                >
                  {t('casesTable.next')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

export default CasesTable
