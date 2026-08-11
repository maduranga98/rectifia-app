import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ACTION_CATEGORIES,
  MIN_REASON_LENGTH,
  closeCase,
  proposeAction,
  reviewConsistencyFlag,
  revealReporterIdentity,
} from '../../services/handlerService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Select, Textarea, Input } from '../ui/Field'
import PolicyReferences from './PolicyReferences'

// Re-exported as one of this file's case panels so the workspace places it
// alongside the checklist and consistency-flag panels. It renders the policy
// clauses that grounded this case (from case.policyCitations) as read-only
// provenance - see PolicyReferences.jsx.
export { PolicyReferences }

// The building blocks of a Case Handler's single-case workspace. This file used
// to also hold the component that stacked them all into one scroll; that layout
// is now CaseWorkspacePage, which arranges these same pieces - their internals
// unchanged - into URL-addressable tabs. Each is exported so the workspace can
// place it on its own tab. The consistency check's close-gating still lives in
// ActionForm exactly as before.

const CONSISTENCY_TONE = {
  insufficient_data: 'tone-neutral',
  consistent: 'tone-low',
  unrankable: 'tone-neutral',
  flagged: 'tone-high',
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

export function ConsistencyFlags({ caseData }) {
  const { t } = useTranslation()
  const check = caseData.consistencyCheck
  if (!check) {
    return (
      <EmptyState
        compact
        icon="sparkle"
        title={t('caseDetailView.consistencyFlags.empty.title')}
        description={t('caseDetailView.consistencyFlags.empty.description')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Badge tone={CONSISTENCY_TONE[check.status] ?? CONSISTENCY_TONE.unrankable} dot>
        {t(`caseDetailView.consistencyStatus.${check.status}`, { defaultValue: humanize(check.status) })}
      </Badge>
      {check.flag && <p className="text-sm text-charcoal">{check.flag.message}</p>}
      {typeof check.similarCaseCount === 'number' && (
        <p className="text-xs text-muted">
          {t('caseDetailView.consistencyFlags.similarCasesConsidered', { count: check.similarCaseCount })}
        </p>
      )}
    </div>
  )
}

export function QuestionnaireAnswers({ caseData }) {
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
  const { t } = useTranslation()
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
      <Alert variant="success" title={t('caseDetailView.flagReviewed.title')}>
        <p>{flag.message}</p>
        {flag.reviewNote && (
          <p className="mt-1.5">{t('caseDetailView.flagReviewed.reviewerNote', { note: flag.reviewNote })}</p>
        )}
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert
        variant={FLAG_DIRECTION_VARIANT[flag.direction] ?? 'warning'}
        title={t('caseDetailView.flagBanner.title', {
          direction: t(`caseDetailView.flagDirection.${flag.direction}`, { defaultValue: humanize(flag.direction) }),
        })}
      >
        <p>{flag.message}</p>
        <p className="mt-1.5 text-xs">{t('caseDetailView.flagBanner.body')}</p>
      </Alert>

      <form onSubmit={handleReview} className="flex flex-col gap-3">
        <Textarea
          label={t('caseDetailView.flagBanner.reviewNoteLabel')}
          rows={2}
          placeholder={t('caseDetailView.flagBanner.reviewNotePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          loading={submitting}
          loadingLabel={t('caseDetailView.saving')}
          disabled={!note.trim()}
        >
          {t('caseDetailView.flagBanner.markReviewed')}
        </Button>
      </form>

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  )
}

const IDENTITY_FIELD_LABEL_DEFAULTS = {
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
  const { t } = useTranslation()
  const entries = Object.entries(identity ?? {}).filter(([, value]) => value != null && value !== '')
  if (entries.length === 0) {
    return <p className="text-sm text-muted">{t('caseDetailView.identity.noFieldsStored')}</p>
  }
  return (
    <dl className="flex flex-col divide-y divide-line-soft">
      {entries.map(([key, value]) => (
        <div key={key} className="py-2 first:pt-0 last:pb-0">
          <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted">
            {t(`caseDetailView.identity.fields.${key}`, { defaultValue: IDENTITY_FIELD_LABEL_DEFAULTS[key] ?? humanize(key) })}
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
export function ReporterIdentityCard({ caseData }) {
  const { t } = useTranslation()
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
    <Card title={t('caseDetailView.identity.title')} padded={false}>
      <div className="px-5 py-4">
        {!expanded ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              {t('caseDetailView.identity.confidentialIntro')}{' '}
              {hasIdentityOnFile
                ? t('caseDetailView.identity.onFileHint')
                : t('caseDetailView.identity.nothingToReveal')}
            </p>
            <Button
              variant="secondary"
              icon="shield"
              className="self-start"
              onClick={() => setExpanded(true)}
            >
              {hasIdentityOnFile ? t('caseDetailView.identity.revealButton') : t('caseDetailView.identity.showStatusButton')}
            </Button>
          </div>
        ) : !hasIdentityOnFile ? (
          <div className="flex flex-col gap-3">
            <Alert variant="info" title={t('caseDetailView.identity.noneOnFile.title')}>
              {t('caseDetailView.identity.noneOnFile.body')}
            </Alert>
            <Button variant="ghost" className="self-start" onClick={() => setExpanded(false)}>
              {t('caseDetailView.identity.hide')}
            </Button>
          </div>
        ) : identity ? (
          <div className="flex flex-col gap-3">
            <Alert variant="warning" title={t('caseDetailView.identity.revealed.title')}>
              {t('caseDetailView.identity.revealed.body')}
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
              {t('caseDetailView.identity.hideIdentity')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-charcoal">
              {fieldsOnFile.length > 0
                ? t('caseDetailView.identity.onFileList', {
                    fields: fieldsOnFile
                      .map((f) =>
                        t(`caseDetailView.identity.fields.${f}`, {
                          defaultValue: IDENTITY_FIELD_LABEL_DEFAULTS[f] ?? f,
                        }).toLowerCase()
                      )
                      .join(', '),
                  })
                : t('caseDetailView.identity.onFileGeneric')}
            </p>
            <Alert variant="warning" title={t('caseDetailView.identity.revealWarning.title')}>
              {t('caseDetailView.identity.revealWarning.body')}
            </Alert>
            <Textarea
              label={t('caseDetailView.identity.reasonLabel')}
              rows={3}
              placeholder={t('caseDetailView.identity.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button
                variant="danger"
                icon="shield"
                onClick={handleReveal}
                loading={revealing}
                loadingLabel={t('caseDetailView.identity.revealing')}
                disabled={!reasonValid}
              >
                {t('caseDetailView.identity.revealIdentityButton')}
              </Button>
              <Button variant="ghost" onClick={() => setExpanded(false)} disabled={revealing}>
                {t('common.cancel')}
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
export function ActionForm({ caseData, onChanged }) {
  const { t } = useTranslation()
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
      <Alert variant="success" title={t('caseDetailView.actionForm.caseClosed')}>
        {t('caseDetailView.actionForm.finalAction', {
          action: caseData.actionTaken
            ? t(`actionLabels.${caseData.actionTaken}`, { defaultValue: humanize(caseData.actionTaken) })
            : t('caseDetailView.actionForm.notRecorded'),
        })}
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <ConsistencyFlagBanner caseData={caseData} onChanged={onChanged} />

      <form onSubmit={handlePropose} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t('caseDetailView.actionForm.categoryLabel')}
            value={actionCategory}
            onChange={(e) => setActionCategory(e.target.value)}
          >
            {ACTION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`actionLabels.${category}`, { defaultValue: humanize(category) })}
              </option>
            ))}
          </Select>

          <Input
            label={t('caseDetailView.actionForm.effectiveDateLabel')}
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </div>

        <Textarea
          label={t('caseDetailView.actionForm.notesLabel')}
          rows={3}
          placeholder={t('caseDetailView.actionForm.notesPlaceholder')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <Button
          type="submit"
          variant="primary"
          className="self-start"
          loading={submitting}
          loadingLabel={t('caseDetailView.saving')}
          disabled={!notes.trim() || !effectiveDate}
        >
          {caseData.proposedAction ? t('caseDetailView.actionForm.updateProposed') : t('caseDetailView.actionForm.propose')}
        </Button>
      </form>

      {caseData.proposedAction && (
        <div className="rounded-lg border border-line bg-navy-50/60 p-4">
          <p className="text-sm text-charcoal">
            {t('caseDetailView.actionForm.proposedAction')}{' '}
            <strong>{t(`actionLabels.${caseData.proposedAction}`, { defaultValue: humanize(caseData.proposedAction) })}</strong>
          </p>
          <p className="mt-1.5 text-xs text-muted">
            {canClose
              ? t('caseDetailView.actionForm.checkComplete')
              : t('caseDetailView.actionForm.checkWaiting')}
          </p>
          <Button
            variant="danger"
            className="mt-3"
            onClick={handleClose}
            disabled={!canClose}
            loading={submitting}
            loadingLabel={t('caseDetailView.actionForm.closing')}
          >
            {t('caseDetailView.actionForm.markClosed')}
          </Button>
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}
    </div>
  )
}
