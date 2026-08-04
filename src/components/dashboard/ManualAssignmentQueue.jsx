import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listCaseHandlers,
  listCasesNeedingManualAssignment,
  reassignCase,
} from '../../services/routingService'
import { auth } from '../../services/firebase'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { SkeletonList } from '../ui/Loading'

// Why routeCase.js gave up and asked for a human, in the Super Admin's terms.
// The keys are the exact reasons sendToManualAssignment() writes - anything
// else falls through to a neutral row rather than rendering a raw enum.
const ROUTING_REASONS = {
  missing_company_id: {
    label: 'No company on the case',
    tone: 'tone-critical',
    description:
      'This report was submitted without a company, so there was nothing to route it against. Pick the company it belongs to, then a Case Handler.',
  },
  no_routing_rule: {
    label: 'No routing rule',
    tone: 'tone-high',
    description:
      'The company has no routing rule for this category and department, so there was no handler to send it to.',
  },
  conflict_of_interest: {
    label: 'Conflict of interest',
    tone: 'tone-high',
    description:
      'The handler this case would have routed to (or a Company Admin) matches the department and role of the person the report is about. Pick someone outside that line of reporting.',
  },
}

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

// The queue of cases routeCase.js could not route automatically. Everything
// rendered here - caseId, companyId, category, department, priority,
// routingReason - comes from caseMetadata/{caseId}, the metadata-only mirror;
// Super Admin's read of it is narrowed by firestore.rules to exactly this
// status. No case content, no questionnaire responses, no messages appear
// here, and there is no rules path from this role to any of them, so that
// stays true no matter what this component asks for.
//
// Assignment goes through the existing reassignCase callable (module 7's
// admin-facing reassignment), not a second write path: cases/{caseId} is not
// client-writable at all, and reassignCase is already the one place that
// changes who a case is assigned to.
function ManualAssignmentQueue({ companies = [], onCountChange }) {
  const [cases, setCases] = useState([])
  const [handlersByCompany, setHandlersByCompany] = useState({})
  const [companyChoice, setCompanyChoice] = useState({})
  const [loading, setLoading] = useState(true)
  const [assigningId, setAssigningId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const companyNameById = useMemo(() => {
    const map = new Map()
    companies.forEach((company) => map.set(company.id, company.name))
    return map
  }, [companies])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setCases(await listCasesNeedingManualAssignment())
    } catch (err) {
      setError(err.message || 'Could not load the manual-assignment queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Case Handlers are per company, so they're fetched per company id present
  // in the queue rather than up front for every tenant on the platform. A
  // company already in the map (even as an empty list) is not re-fetched.
  const loadHandlers = useCallback(async (companyId) => {
    if (!companyId) return
    let alreadyLoaded = false
    setHandlersByCompany((current) => {
      alreadyLoaded = companyId in current
      return alreadyLoaded ? current : { ...current, [companyId]: [] }
    })
    if (alreadyLoaded) return
    try {
      const handlers = await listCaseHandlers(companyId)
      setHandlersByCompany((current) => ({ ...current, [companyId]: handlers }))
    } catch (err) {
      setError(err.message || 'Could not load case handlers')
    }
  }, [])

  useEffect(() => {
    const companyIds = [...new Set(cases.map((c) => c.companyId).filter(Boolean))]
    companyIds.forEach(loadHandlers)
  }, [cases, loadHandlers])

  // Lets the dashboard show how much is waiting here without running the same
  // query a second time from the companies view.
  useEffect(() => {
    if (!loading) onCountChange?.(cases.length)
  }, [cases.length, loading, onCountChange])

  // For a 'missing_company_id' case the company is the Super Admin's call, so
  // it is chosen in the row; every other case already knows its company.
  function resolvedCompanyId(caseRow) {
    return caseRow.companyId ?? companyChoice[caseRow.caseId] ?? ''
  }

  function handleCompanyChoice(caseId, companyId) {
    setCompanyChoice((current) => ({ ...current, [caseId]: companyId }))
    loadHandlers(companyId)
  }

  async function handleAssign(caseRow, handlerId) {
    const companyId = resolvedCompanyId(caseRow)
    if (!handlerId || !companyId) return
    setAssigningId(caseRow.caseId)
    setError(null)
    setNotice(null)
    try {
      await reassignCase({
        caseId: caseRow.caseId,
        companyId,
        handlerId,
        actorId: auth.currentUser?.uid,
      })
      setNotice(`Case ${caseRow.caseId} assigned.`)
      await refresh()
    } catch (err) {
      setError(err.message || 'Could not assign this case')
    } finally {
      setAssigningId(null)
    }
  }

  const firstLoad = loading && cases.length === 0

  if (firstLoad) return <SkeletonList rows={3} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Cases automatic routing could not place. Metadata only - the report itself stays with the
          handler you assign it to.
        </p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
          Refresh
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {cases.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="check"
            title="Nothing waiting on you"
            description="Every case has routed to a handler. Cases land here only when routing has no rule to follow, hits a conflict of interest, or arrives without a company."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {cases.map((caseRow) => {
            const reason = ROUTING_REASONS[caseRow.routingReason] ?? {
              label: humanize(caseRow.routingReason) ?? 'Unrouted',
              tone: 'tone-neutral',
              description: 'This case is waiting for a handler to be assigned by hand.',
            }
            const companyId = resolvedCompanyId(caseRow)
            const handlers = handlersByCompany[companyId] ?? []
            const busy = assigningId === caseRow.caseId
            const companyName = caseRow.companyId
              ? companyNameById.get(caseRow.companyId) ?? caseRow.companyId
              : null

            return (
              <Card key={caseRow.caseId} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-charcoal">
                      {caseRow.caseId}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {companyName ?? 'No company on the case'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {caseRow.priority && (
                      <Badge tone={PRIORITY_TONE[caseRow.priority] ?? 'tone-neutral'} dot>
                        {caseRow.priority}
                      </Badge>
                    )}
                    <Badge tone={reason.tone}>{reason.label}</Badge>
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">Category</dt>
                    <dd className="mt-0.5 font-medium capitalize text-charcoal">
                      {humanize(caseRow.category) ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Department</dt>
                    <dd className="mt-0.5 font-medium text-charcoal">
                      {humanize(caseRow.department) ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Priority</dt>
                    <dd className="mt-0.5 font-medium capitalize text-charcoal">
                      {caseRow.priority ?? '—'}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs text-muted">{reason.description}</p>

                {/* The routing rule itself is a Company Admin setting (module
                    7), so the fix for a repeat offender isn't another manual
                    assignment - it's the company configuring the rule once. */}
                {caseRow.routingReason === 'no_routing_rule' && (
                  <Alert variant="info" className="mt-3">
                    Ask {companyName ?? 'this company'}&apos;s Company Admin to add a routing rule
                    for <span className="font-medium">{humanize(caseRow.category) ?? 'this category'}</span>
                    {' / '}
                    <span className="font-medium">{humanize(caseRow.department) ?? 'unspecified'}</span>{' '}
                    so future reports route without landing here.
                  </Alert>
                )}

                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line-soft pt-4">
                  {!caseRow.companyId && (
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Company
                      <select
                        aria-label={`Company for case ${caseRow.caseId}`}
                        className="field w-56 py-1 text-xs"
                        value={companyChoice[caseRow.caseId] ?? ''}
                        disabled={busy}
                        onChange={(e) => handleCompanyChoice(caseRow.caseId, e.target.value)}
                      >
                        <option value="">Select a company...</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="flex flex-col gap-1 text-xs text-muted">
                    Case Handler
                    <select
                      aria-label={`Assign case ${caseRow.caseId}`}
                      className="field w-56 py-1 text-xs"
                      value=""
                      disabled={busy || !companyId}
                      onChange={(e) => handleAssign(caseRow, e.target.value)}
                    >
                      <option value="" disabled>
                        {busy ? 'Assigning...' : 'Assign to...'}
                      </option>
                      {handlers.map((handler) => (
                        <option key={handler.id} value={handler.id}>
                          {handler.email ?? handler.id}
                        </option>
                      ))}
                    </select>
                  </label>

                  {companyId && handlers.length === 0 && (
                    <p className="text-xs text-critical">
                      This company has no Case Handlers yet - one has to be invited before the case
                      can be assigned.
                    </p>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ManualAssignmentQueue
