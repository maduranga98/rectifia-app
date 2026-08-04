import { useCallback, useEffect, useState } from 'react'
import { ACTION_CATEGORIES, closeCase, getAssignedCase, proposeAction } from '../../services/handlerService'
import ComplianceCountdown from '../dashboard/ComplianceCountdown'
import CaseThread from '../intake/CaseThread'
import InvestigationChecklist from './InvestigationChecklist'

const POLL_INTERVAL_MS = 8000

const CONSISTENCY_STYLE = {
  insufficient_data: 'tone-neutral',
  consistent: 'tone-low',
  unrankable: 'tone-neutral',
  flagged: 'tone-high',
}

function ConsistencyFlags({ caseData }) {
  const check = caseData.consistencyCheck
  if (!check) {
    return <p className="text-sm text-muted">No consistency check has run for this case yet.</p>
  }

  return (
    <div className={`rounded border px-3 py-2 text-sm ${CONSISTENCY_STYLE[check.status] ?? CONSISTENCY_STYLE.unrankable}`}>
      <p className="font-medium">{check.status}</p>
      {check.flag && <p className="mt-1">{check.flag.message}</p>}
      {typeof check.similarCaseCount === 'number' && (
        <p className="mt-1 text-xs opacity-80">{check.similarCaseCount} similar case(s) considered.</p>
      )}
    </div>
  )
}

function QuestionnaireAnswers({ caseData }) {
  const responses = Array.isArray(caseData.responses) ? caseData.responses : []
  if (responses.length === 0) {
    return <p className="text-sm text-muted">No questionnaire responses on file.</p>
  }

  return (
    <ul className="flex flex-col gap-2 text-sm">
      {responses.map((response) => (
        <li key={response.questionId} className="field rounded px-3 py-2">
          <p className="text-xs text-muted">{response.questionId}</p>
          <p className="mt-1">{Array.isArray(response.value) ? response.value.join(', ') : String(response.value ?? '')}</p>
        </li>
      ))}
    </ul>
  )
}

// This form is the only way a proposed action gets written to the case
// (via handlerService.proposeAction -> functions/src/investigation/caseActions.js),
// which is what starts module 10's consistency check running. Closing the
// case is a second, separate step gated on that check having finished
// against the current proposal - see handlerService.closeCase.
function ActionForm({ caseData, onChanged }) {
  const [actionCategory, setActionCategory] = useState(ACTION_CATEGORIES[0])
  const [notes, setNotes] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const alreadyClosed = caseData.status === 'closed'
  const canClose =
    Boolean(caseData.proposedAction) &&
    Boolean(caseData.consistencyCheck?.checkedAt) &&
    caseData.consistencyCheck.checkedAt.toMillis() >= (caseData.proposedActionAt?.toMillis() ?? Infinity)

  async function handlePropose(event) {
    event.preventDefault()
    if (!notes.trim() || !effectiveDate) return
    setSubmitting(true)
    setError(null)
    try {
      await proposeAction(caseData.id, { actionCategory, notes, effectiveDate })
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleClose() {
    setSubmitting(true)
    setError(null)
    try {
      await closeCase(caseData.id)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (alreadyClosed) {
    return <p className="text-sm text-muted">This case is closed. Final action: {caseData.actionTaken}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handlePropose} className="flex flex-col gap-3">
        <div>
          <label htmlFor="action-category" className="block text-sm font-medium">
            Category of action
          </label>
          <select
            id="action-category"
            value={actionCategory}
            onChange={(e) => setActionCategory(e.target.value)}
            className="mt-1 w-full field rounded px-3 py-2 text-sm"
          >
            {ACTION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="action-notes" className="block text-sm font-medium">
            Notes
          </label>
          <textarea
            id="action-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full field rounded px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="action-effective-date" className="block text-sm font-medium">
            Effective date
          </label>
          <input
            id="action-effective-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="mt-1 w-full field rounded px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="self-start btn-primary rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {caseData.proposedAction ? 'Update proposed action' : 'Propose action'}
        </button>
      </form>

      {caseData.proposedAction && (
        <div className="rounded-lg border border-line bg-surface p-3 text-sm">
          <p>
            Proposed action: <strong>{caseData.proposedAction.replace(/_/g, ' ')}</strong>
          </p>
          <p className="mt-2 text-xs text-muted">
            {canClose
              ? 'Consistency check complete - this case can be closed.'
              : 'Waiting for the consistency check to finish against this proposal before the case can be closed.'}
          </p>
          <button
            type="button"
            onClick={handleClose}
            disabled={!canClose || submitting}
            className="mt-2 btn-danger rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            Mark case closed
          </button>
        </div>
      )}

      {error && <p className="text-sm text-critical">{error}</p>}
    </div>
  )
}

// Combines everything a Case Handler needs to work a single case: the
// questionnaire responses, the case thread (module 8), the investigation
// checklist (module 9), consistency flags (module 10), the compliance
// countdown (module 11), and the action-taking form (module 12). Fetching
// the case doc goes through handlerService.getAssignedCase(), which
// firestore.rules only permits when this case is assigned to the
// signed-in handler - there is no separate "is this case mine" check here
// because there doesn't need to be one.
function CaseDetailView({ caseId, investigatorId }) {
  const [caseData, setCaseData] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const result = await getAssignedCase(caseId)
      setCaseData(result)
    } catch (err) {
      setError(err.message)
    }
  }, [caseId])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refresh])

  if (error) return <p className="p-6 text-sm text-critical">{error}</p>
  if (!caseData) return <p className="p-6 text-sm text-muted">Loading case...</p>

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold">Case {caseData.caseId ?? caseData.id}</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-charcoal">Questionnaire answers</h2>
        <QuestionnaireAnswers caseData={caseData} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-charcoal">Compliance</h2>
        <ComplianceCountdown caseData={caseData} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-charcoal">Consistency check</h2>
        <ConsistencyFlags caseData={caseData} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-charcoal">Investigation checklist</h2>
        <InvestigationChecklist caseId={caseId} investigatorId={investigatorId} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-charcoal">Case thread</h2>
        <CaseThread caseId={caseId} mode="investigator" investigatorId={investigatorId} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-charcoal">Take action</h2>
        <ActionForm caseData={caseData} onChanged={refresh} />
      </section>
    </div>
  )
}

export default CaseDetailView
