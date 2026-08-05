import { useCallback, useEffect, useState } from 'react'
import {
  ACTION_CATEGORIES,
  MIN_REASON_LENGTH,
  closeCase,
  getAssignedCase,
  proposeAction,
  reviewConsistencyFlag,
  revealReporterIdentity,
} from '../../services/handlerService'
import ComplianceCountdown from '../dashboard/ComplianceCountdown'
import CaseThread from '../intake/CaseThread'
import CaseReport from './CaseReport'
import InvestigationChecklist from './InvestigationChecklist'
import RelatedPatternNotice from './RelatedPatternNotice'
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

// The consistency flag is deliberately advisory: it maps a flagged
// deviation to an Alert whose tone matches the *direction* (harsher vs
// lenient) so both are surfaced with equal weight, and it never suggests an
// action or gates the form below it. All the handler can do here is
// acknowledge it with a note - "flag never suggests, human decides".
const FLAG_DIRECTION_VARIANT = {
  harsher: 'warning',
  lenient: 'info',
}

function ConsistencyFlagBanner({ caseData, onChanged }) {
  const check = caseData.consistencyCheck
  const flag = check?.status === 'flagged' ? check.flag : null
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (!flag) return null

  const reviewed = Boolean(flag.reviewedAt)

  async function handleReview(event) {
    event.preventDefault()
    if (!note.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await reviewConsistencyFlag(caseData.id, note)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (reviewed) {
    return (
      <Alert variant="success" title="Consistency flag reviewed">
        <p>{flag.message}</p>
        {flag.reviewNote && <p className="mt-1.5">Reviewer note: {flag.reviewNote}</p>}
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert
        variant={FLAG_DIRECTION_VARIANT[flag.direction] ?? 'warning'}
        title={`Consistency flag - proposed action is ${humanize(flag.direction)} than typical`}
      >
        <p>{flag.message}</p>
        <p className="mt-1.5 text-xs">
          This is informational only. It does not suggest an action or stop you from proposing or
          closing this case - the decision remains yours. Add a note to record that you have seen
          and considered it.
        </p>
      </Alert>

      <form onSubmit={handleReview} className="flex flex-col gap-3">
        <Textarea
          label="Review note"
          rows={2}
          placeholder="Note why the proposed action is appropriate despite the flag."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          loading={submitting}
          loadingLabel="Saving"
          disabled={!note.trim()}
        >
          Mark reviewed
        </Button>
      </form>

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  )
}

const IDENTITY_FIELD_LABELS = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  jobTitle: 'Job title',
  notes: 'Notes',
}

// Renders one revealed identity field/value pair per line. `identity` is the
// decrypted object returned by the callable - it lives only in the parent's
// component state for this session and is never persisted.
function RevealedIdentity({ identity }) {
  const entries = Object.entries(identity ?? {}).filter(([, value]) => value != null && value !== '')
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No identity fields were stored.</p>
  }
  return (
    <dl className="flex flex-col divide-y divide-line-soft">
      {entries.map(([key, value]) => (
        <div key={key} className="py-2 first:pt-0 last:pb-0">
          <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted">
            {IDENTITY_FIELD_LABELS[key] ?? humanize(key)}
          </dt>
          <dd className="mt-1 text-sm text-charcoal">
            {Array.isArray(value) ? value.join(', ') : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// Confidential-tier reporter identity, revealed on demand behind a logged
// reason (Blueprint §7.1). Rendered only for confidential-tier cases - an
// anonymous case has no such card at all. The revealed plaintext is held in
// this component's state only: it is never cached or persisted, and unmounting
// (leaving the case) drops it, so returning re-requests it with a fresh reason.
//
// Two confidential states are shown distinctly, because they are genuinely
// different situations for an investigator: an identity IS on file (the report
// was filed on the reporter's behalf via createCaseOnBehalf, which vaulted
// their details) versus NONE is on file (the reporter self-submitted and chose
// confidential, so submitCase recorded the tier but vaulted nothing - there is
// simply nobody named to reveal).
function ReporterIdentityCard({ caseData }) {
  const [expanded, setExpanded] = useState(false)
  const [reason, setReason] = useState('')
  const [identity, setIdentity] = useState(null)
  const [revealing, setRevealing] = useState(false)
  const [error, setError] = useState(null)

  // The case doc carries the identity envelope's *key names* (fieldsOnFile) and
  // metadata, never the plaintext; its mere presence is how we tell "identity
  // on file" from "confidential but self-submitted, nothing vaulted".
  const record = caseData.reporterIdentity
  const hasIdentityOnFile = Boolean(record)
  const fieldsOnFile = Array.isArray(record?.fieldsOnFile) ? record.fieldsOnFile : []
  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH

  async function handleReveal() {
    if (!reasonValid) return
    setRevealing(true)
    setError(null)
    try {
      const result = await revealReporterIdentity(caseData.id, reason)
      setIdentity(result.identity)
    } catch (err) {
      setError(err.message)
    } finally {
      setRevealing(false)
    }
  }

  return (
    <Card title="Reporter identity" padded={false}>
      <div className="px-5 py-4">
        {!expanded ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              This is a confidential-tier report.{' '}
              {hasIdentityOnFile
                ? 'Reporter identity details are on file and can be revealed with a logged reason.'
                : 'The reporter self-submitted and provided no identity details, so there is nothing to reveal.'}
            </p>
            <Button
              variant="secondary"
              icon="shield"
              className="self-start"
              onClick={() => setExpanded(true)}
            >
              {hasIdentityOnFile ? 'Reveal reporter identity' : 'Show identity status'}
            </Button>
          </div>
        ) : !hasIdentityOnFile ? (
          <div className="flex flex-col gap-3">
            <Alert variant="info" title="No identity on file">
              This reporter filed confidentially through the web form and chose not to provide any
              identifying details. Nothing was stored, so there is nothing to reveal here - the
              case thread is the only channel back to them.
            </Alert>
            <Button variant="ghost" className="self-start" onClick={() => setExpanded(false)}>
              Hide
            </Button>
          </div>
        ) : identity ? (
          <div className="flex flex-col gap-3">
            <Alert variant="warning" title="Identity revealed - this access has been logged">
              Your identity, this case, and your reason are recorded in the access log. This is
              shown for this session only and is not stored here; leaving and returning will require
              a fresh reason.
            </Alert>
            <RevealedIdentity identity={identity} />
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                setIdentity(null)
                setReason('')
              }}
            >
              Hide identity
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-charcoal">
              {fieldsOnFile.length > 0
                ? `On file for this reporter: ${fieldsOnFile
                    .map((f) => (IDENTITY_FIELD_LABELS[f] ?? f).toLowerCase())
                    .join(', ')}.`
                : 'Reporter identity details are on file.'}
            </p>
            <Alert variant="warning" title="Revealing identity is logged and attributable">
              Revealing a confidential reporter&apos;s identity is a deliberate act. Before you
              proceed, know that your identity, this case, the time, and the reason you type below
              are written to the access log. Only do this when you have a documented reason to.
            </Alert>
            <Textarea
              label="Reason for revealing this identity"
              rows={3}
              placeholder="Record why this reporter's identity needs to be revealed (min. 10 characters)."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button
                variant="danger"
                icon="shield"
                onClick={handleReveal}
                loading={revealing}
                loadingLabel="Revealing"
                disabled={!reasonValid}
              >
                Reveal identity
              </Button>
              <Button variant="ghost" onClick={() => setExpanded(false)} disabled={revealing}>
                Cancel
              </Button>
            </div>
            {error && <Alert variant="error">{error}</Alert>}
          </div>
        )}
      </div>
    </Card>
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
      <ConsistencyFlagBanner caseData={caseData} onChanged={onChanged} />

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
  const [showReport, setShowReport] = useState(false)

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

  // A closed case has a compiled report to show. CaseReport is a self-
  // contained, read-only view (it fetches via generateReport on its own), so
  // rather than squeezing it into a card it replaces the working layout
  // entirely, with a way back to the case summary.
  if (closed && showReport) {
    return (
      <div className="flex flex-col gap-5">
        <Button
          variant="secondary"
          icon="back"
          className="self-start print:hidden"
          onClick={() => setShowReport(false)}
        >
          Back to case
        </Button>
        <CaseReport caseId={caseId} />
      </div>
    )
  }

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

          <Card
            title={closed ? 'Case outcome' : 'Take action'}
            description={closed ? undefined : 'Proposing an action starts the consistency check.'}
            actions={
              closed ? (
                <Button variant="primary" icon="document" onClick={() => setShowReport(true)}>
                  View report
                </Button>
              ) : undefined
            }
          >
            <ActionForm caseData={caseData} onChanged={refresh} />
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {/* Only confidential-tier cases carry a revealable identity. An
              anonymous case never renders this card - there is nothing behind
              it - so its absence is itself accurate. */}
          {caseData.tier === 'confidential' && <ReporterIdentityCard caseData={caseData} />}

          <Card title="Compliance deadlines">
            <ComplianceCountdown caseData={caseData} />
          </Card>

          {/* Alongside the consistency flag, not merged into it: the two
              answer different questions. The consistency check compares the
              action proposed here against how comparable closed cases were
              resolved; a pattern signal says nothing about actions at all,
              only that other open or closed cases share this case's
              department and role tier. Renders nothing when this case is not
              in a signal. */}
          <RelatedPatternNotice caseId={caseId} />

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
