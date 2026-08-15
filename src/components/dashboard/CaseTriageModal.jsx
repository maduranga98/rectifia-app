import { useCallback, useEffect, useState } from 'react'
import { getCaseForTriage } from '../../services/triageService'
import { listCaseHandlers, reassignCase } from '../../services/routingService'
import { auth } from '../../services/firebase'
import { CATEGORIES } from '../../data/categories'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { SkeletonList } from '../ui/Loading'

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

// The callable returns timestamps as milliseconds (see toMillis() in
// functions/src/investigation/getCaseForTriage.js), not Firestore
// Timestamps - there is no .toMillis() to call on these.
function formatDate(ms) {
  if (!ms) return '-'
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Reading an unassigned case in order to place it. The whole point of this
// modal is that it is the ONLY place either oversight role sees case
// content: the dashboard tables behind it are still fed by the metadata-only
// caseMetadata mirror, and everything rendered here arrives from the
// getCaseForTriage callable, which builds its response as an explicit
// allowlist under the Admin SDK. Neither role has (or gains) a Firestore
// rules path to cases/{caseId} itself.
//
// What is deliberately absent: the message thread, which stays with the
// assigned handler, and every confidential-tier identity field, encrypted or
// not. Those are not filtered out in this component - they never leave the
// server, so no change here can surface them.
//
// Assignment reuses the reassignCase callable the HR Coordinator dashboard,
// RoutingRulesPage and the Super Admin queue already call. cases/{caseId} is
// not client-writable, and adding a second write path for "assign from the
// triage modal" would mean two places to keep the conflict-of-interest and
// company-match guards in step.
function CaseTriageModal({ caseId, companyId, onClose, onAssigned }) {
  const [triageCase, setTriageCase] = useState(null)
  const [handlers, setHandlers] = useState([])
  const [handlerId, setHandlerId] = useState('')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([getCaseForTriage(caseId), listCaseHandlers(companyId)])
      .then(([caseData, handlerRows]) => {
        if (cancelled) return
        setTriageCase(caseData)
        setHandlers(handlerRows)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not open this case')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [caseId, companyId])

  const close = useCallback(() => onClose?.(), [onClose])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  async function handleAssign() {
    if (!handlerId) return
    setAssigning(true)
    setError(null)
    try {
      await reassignCase({ caseId, companyId, handlerId, actorId: auth.currentUser?.uid })
      // The case is placed, so triage is over - the modal closes and the
      // list behind it reloads rather than keeping a now-stale row on screen.
      onAssigned?.(caseId)
      close()
    } catch (err) {
      setError(err.message || 'Could not assign this case')
      setAssigning(false)
    }
  }

  const categoryLabel =
    CATEGORIES.find((c) => c.id === triageCase?.category)?.label ??
    humanize(triageCase?.category) ??
    'Uncategorized'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal/40 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Case ${caseId}`}
        className="card my-auto w-full max-w-2xl overflow-hidden"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold text-charcoal">{caseId}</p>
            <p className="mt-0.5 text-xs text-muted">
              Read this report to decide who should handle it. It is not yours to investigate.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="btn btn-ghost shrink-0 px-2 py-1"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {error && <Alert variant="error">{error}</Alert>}

          {loading ? (
            <SkeletonList rows={4} />
          ) : (
            triageCase && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="tone-info">{categoryLabel}</Badge>
                  {triageCase.priority && (
                    <Badge tone={PRIORITY_TONE[triageCase.priority] ?? 'tone-neutral'} dot>
                      {triageCase.priority}
                    </Badge>
                  )}
                  <Badge tone="tone-neutral">{humanize(triageCase.status) ?? 'open'}</Badge>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">Department</dt>
                    <dd className="mt-0.5 font-medium text-charcoal">
                      {humanize(triageCase.department) ?? 'unspecified'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Severity</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-charcoal">
                      {triageCase.severityScore ?? '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Evidence</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-charcoal">
                      {triageCase.evidenceScore ?? '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Submitted</dt>
                    <dd className="mt-0.5 font-medium text-charcoal">
                      {formatDate(triageCase.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Acknowledgment due</dt>
                    <dd className="mt-0.5 font-medium text-charcoal">
                      {formatDate(triageCase.acknowledgmentDueAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Feedback due</dt>
                    <dd className="mt-0.5 font-medium text-charcoal">
                      {formatDate(triageCase.feedbackDueAt)}
                    </dd>
                  </div>
                </dl>

                {triageCase.routingReason && (
                  <p className="mt-3 text-xs text-muted">
                    Waiting because: {humanize(triageCase.routingReason)}
                  </p>
                )}

                <section className="mt-5 border-t border-line-soft pt-4">
                  <h4 className="text-sm font-semibold text-charcoal">What was reported</h4>
                  <p className="mt-1 text-xs text-muted">
                    The reporter&apos;s questionnaire answers. The message thread stays with the
                    handler you assign.
                  </p>
                  {triageCase.answers.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">No questionnaire answers on this case.</p>
                  ) : (
                    <dl className="mt-3 flex flex-col gap-3">
                      {triageCase.answers.map((answer) => (
                        <div key={answer.questionId}>
                          <dt className="text-xs text-muted">{answer.question}</dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-sm text-charcoal">
                            {answer.answer}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              </>
            )
          )}
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-3 border-t border-line-soft bg-navy-50/50 px-5 py-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Assign to
            <select
              aria-label={`Assign case ${caseId}`}
              className="field w-56 py-1 text-xs"
              value={handlerId}
              disabled={loading || assigning || handlers.length === 0}
              onChange={(e) => setHandlerId(e.target.value)}
            >
              <option value="" disabled>
                {handlers.length === 0 ? 'No Case Handlers yet' : 'Select a Case Handler'}
              </option>
              {handlers.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.email ?? h.id}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <Button onClick={close} disabled={assigning}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="check"
              onClick={handleAssign}
              disabled={!handlerId || loading}
              loading={assigning}
              loadingLabel="Assigning"
            >
              Assign
            </Button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default CaseTriageModal
