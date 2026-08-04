import { useCallback, useEffect, useState } from 'react'
import { ACTION_CATEGORIES, closeCase, getAssignedCase, proposeAction } from '../../services/handlerService'
import ComplianceCountdown from '../dashboard/ComplianceCountdown'
import CaseThread from '../intake/CaseThread'
import InvestigationChecklist from './InvestigationChecklist'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Select, Textarea, Input } from '../ui/Field'
import { SkeletonList } from '../ui/Loading'

const POLL_INTERVAL_MS = 8000

const CONSISTENCY_TONE = {
  insufficient_data: 'tone-neutral',
  consistent: 'tone-low',
  unrankable: 'tone-neutral',
  flagged: 'tone-high',
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

function ConsistencyFlags({ caseData }) {
  const check = caseData.consistencyCheck
  if (!check) {
    return (
      <EmptyState
        compact
        icon="sparkle"
        title="No consistency check yet"
        description="A check runs automatically once an action is proposed on this case."
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Badge tone={CONSISTENCY_TONE[check.status] ?? CONSISTENCY_TONE.unrankable} dot>
        {humanize(check.status)}
      </Badge>
      {check.flag && <p className="text-sm text-charcoal">{check.flag.message}</p>}
      {typeof check.similarCaseCount === 'number' && (
        <p className="text-xs text-muted">{check.similarCaseCount} similar case(s) considered.</p>
      )}
    </div>
  )
}

function QuestionnaireAnswers({ caseData }) {
  const responses = Array.isArray(caseData.responses) ? caseData.responses : []
  if (responses.length === 0) {
    return (
      <EmptyState compact icon="document" title="No questionnaire responses on file" />
    )
  }

  // A definition list rather than a stack of boxes: these are question and
  // answer pairs, and marking them up as such is both more readable and
  // what a screen reader needs to pair them.
  return (
    <dl className="flex flex-col divide-y divide-line-soft">
      {responses.map((response) => (
        <div key={response.questionId} className="py-3 first:pt-0 last:pb-0">
          <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted">
            {humanize(response.questionId)}
          </dt>
          <dd className="mt-1 text-sm text-charcoal">
            {Array.isArray(response.value) ? response.value.join(', ') : String(response.value ?? '')}
          </dd>
        </div>
      ))}
    </dl>
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
    return (
      <Alert variant="success" title="Case closed">
        Final action: {humanize(caseData.actionTaken) ?? 'not recorded'}
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={handlePropose} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Category of action"
            value={actionCategory}
            onChange={(e) => setActionCategory(e.target.value)}
          >
            {ACTION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {humanize(category)}
              </option>
            ))}
          </Select>

          <Input
            label="Effective date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </div>

        <Textarea
          label="Notes"
          rows={3}
          placeholder="What is being done, and on what basis."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <Button
          type="submit"
          variant="primary"
          className="self-start"
          loading={submitting}
          loadingLabel="Saving"
          disabled={!notes.trim() || !effectiveDate}
        >
          {caseData.proposedAction ? 'Update proposed action' : 'Propose action'}
        </Button>
      </form>

      {caseData.proposedAction && (
        <div className="rounded-lg border border-line bg-navy-50/60 p-4">
          <p className="text-sm text-charcoal">
            Proposed action: <strong>{humanize(caseData.proposedAction)}</strong>
          </p>
          <p className="mt-1.5 text-xs text-muted">
            {canClose
              ? 'Consistency check complete - this case can be closed.'
              : 'Waiting for the consistency check to finish against this proposal before the case can be closed.'}
          </p>
          <Button
            variant="danger"
            className="mt-3"
            onClick={handleClose}
            disabled={!canClose}
            loading={submitting}
            loadingLabel="Closing"
          >
            Mark case closed
          </Button>
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}
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
//
// Two columns on wide screens: the thread and the action the handler is
// working through on the left, the reference material they keep glancing at
// (deadlines, consistency, checklist) on the right. The old single stacked
// column put the compliance countdown five scrolls above the button it
// governs.
function CaseDetailView({ caseId }) {
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

  if (error) return <Alert variant="error">{error}</Alert>
  if (!caseData) return <SkeletonList rows={4} />

  const closed = caseData.status === 'closed'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-charcoal">
          Case {caseData.caseId ?? caseData.id}
        </h2>
        <Badge tone={closed ? 'tone-low' : 'tone-info'} dot>
          {humanize(caseData.status) ?? 'open'}
        </Badge>
        {caseData.priority === 'high' && (
          <Badge tone="tone-high" dot>
            High priority
          </Badge>
        )}
        {caseData.category && <span className="text-sm text-muted">{humanize(caseData.category)}</span>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-start">
        <div className="flex flex-col gap-5">
          <Card title="Questionnaire answers">
            <QuestionnaireAnswers caseData={caseData} />
          </Card>

          <Card title="Case thread" description="Messages between the reporter and you.">
            <CaseThread caseId={caseId} mode="investigator" />
          </Card>

          <Card title="Take action" description="Proposing an action starts the consistency check.">
            <ActionForm caseData={caseData} onChanged={refresh} />
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card title="Compliance deadlines">
            <ComplianceCountdown caseData={caseData} />
          </Card>

          <Card title="Consistency check" padded={Boolean(caseData.consistencyCheck)}>
            <ConsistencyFlags caseData={caseData} />
          </Card>

          <InvestigationChecklist caseId={caseId} />
        </div>
      </div>
    </div>
  )
}

export default CaseDetailView
