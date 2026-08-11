import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { upgradeToConfidential } from '../../services/identityTransitionService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Input, Textarea } from '../ui/Field'

// Blueprint §7.2 and §8. The reporter's own route into the identity vault,
// covering both doors that lead here:
//
//   mode="upgrade" - the reporter filed anonymously and has since decided the
//     investigator should know who they are. Changing tier is consequential
//     and irreversible, so the full trade-off is stated and confirmed by
//     typing a phrase before anything is stored.
//
//   mode="provide" - the reporter already chose "be identifiable to the
//     investigator only" at submission (Submit.jsx), which only records that
//     choice - it does not collect details. This is where they supply what
//     that choice promised. The tier decision is already made, so there is
//     nothing left to confirm or warn about undoing.
//
// Everything about how either mode is presented is load-bearing:
//
//   * It is collapsed. A permanently expanded form with the reporter's name
//     waiting to be typed is an invitation, and an invitation from the system
//     is only one step removed from an invitation from the investigator.
//   * It is offered only in the reporter's own view of their own case. There is
//     no staff-side counterpart anywhere in the app and no callable one could
//     be built on - an investigator who wants a name asks in the thread, in
//     their own words, where the asking is on the record.
//   * In upgrade mode, the trade-off is stated in full BEFORE the first input
//     field, not beside the submit button. Someone who has already typed
//     their name has already partly decided; the point at which the
//     consequences matter is before that.
//   * Upgrade cannot be undone, and it says so rather than offering an undo.
//     An "undo" that left the details in the vault would be a lie, and one
//     that deleted them would destroy evidence in a live investigation.
//     Neither is a promise worth making, so the honest thing is to be clear
//     up front. Provide mode has no equivalent framing because there is
//     nothing new to undo - the tier choice, not this form, was the
//     consequential step, and it was already made.
//
// Rendered only while the case is open and no identity is on file yet - see
// CaseDetail.jsx, which chooses the mode from whether the case started
// anonymous or confidential.

const EMPTY_IDENTITY = { name: '', email: '', phone: '', jobTitle: '', notes: '' }

function IdentityPanel({ caseId, passcode, mode = 'upgrade', onSaved, className = '' }) {
  const { t } = useTranslation()
  const isUpgrade = mode !== 'provide'
  const copyKey = isUpgrade ? 'upgrade' : 'provide'
  // A checkbox is a click, and a click is easy to make without reading.
  // Typing the phrase takes long enough to be a decision. It is deliberately
  // short and unambiguous, in plain words rather than an ominous formula,
  // because the friction is meant to be attention, not intimidation. Upgrade
  // mode only - provide mode has no comparable decision left to confirm.
  const confirmPhrase = t('identityPanel.confirmPhrase')

  const [expanded, setExpanded] = useState(false)
  const [identity, setIdentity] = useState(EMPTY_IDENTITY)
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('idle') // idle | working | done | error
  const [error, setError] = useState(null)

  const set = (field) => (event) => setIdentity((prev) => ({ ...prev, [field]: event.target.value }))

  const hasDetail = Object.values(identity).some((value) => value.trim().length > 0)
  const confirmed = isUpgrade ? confirmation.trim().toUpperCase() === confirmPhrase.toUpperCase() : true
  const canSubmit = hasDetail && confirmed && status !== 'working'

  function resetForm() {
    setExpanded(false)
    setIdentity(EMPTY_IDENTITY)
    setConfirmation('')
    setStatus('idle')
    setError(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canSubmit) return
    setStatus('working')
    setError(null)
    try {
      const result = await upgradeToConfidential(caseId, passcode, identity)
      // Cleared immediately: the details belong in the vault, not in a React
      // state object sitting in a tab that may stay open for hours.
      setIdentity(EMPTY_IDENTITY)
      setConfirmation('')
      setStatus('done')
      onSaved?.(result)
    } catch (err) {
      setStatus('error')
      setError(err.message)
    }
  }

  const wrapper = `flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 ${className}`

  if (status === 'done') {
    return (
      <div className={wrapper}>
        <Alert variant="success" title={t(`identityPanel.${copyKey}.doneTitle`)}>
          {t(`identityPanel.${copyKey}.doneBody`)}
        </Alert>
      </div>
    )
  }

  if (!expanded) {
    return (
      <div className={wrapper}>
        <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
          <Icon name="shield" className="h-4 w-4 text-muted" />
          {t(`identityPanel.${copyKey}.collapsedTitle`)}
        </p>
        <p className="text-sm text-muted">{t(`identityPanel.${copyKey}.collapsedBody`)}</p>
        <div>
          <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
            {t(`identityPanel.${copyKey}.collapsedCta`)}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={wrapper}>
      <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
        <Icon name="shield" className="h-4 w-4 text-muted" />
        {t(`identityPanel.${copyKey}.expandedTitle`)}
      </p>

      {/* Stated in full before a single field exists on screen. */}
      <div className="flex flex-col gap-2 rounded-lg border border-navy-200 bg-navy-50 p-3 text-sm text-charcoal">
        <p className="font-medium">{t('identityPanel.whatThisMeans.title')}</p>
        <p>{t(`identityPanel.${copyKey}.whatChanges`)}</p>

        <p className="mt-1 font-medium">{t('identityPanel.whatDoesNotChange.title')}</p>
        <ul className="list-disc pl-5">
          <li>{t('identityPanel.whatDoesNotChange.subjectNeverSees')}</li>
          <li>{t('identityPanel.whatDoesNotChange.hrNeverSees')}</li>
          <li>{t('identityPanel.whatDoesNotChange.adminNeverSees')}</li>
          <li>{t('identityPanel.whatDoesNotChange.nothingElseChanges')}</li>
        </ul>

        {isUpgrade ? (
          <>
            <p className="mt-1 font-medium">{t('identityPanel.cannotBeUndone.title')}</p>
            <p>{t('identityPanel.cannotBeUndone.body1')}</p>
            <p>{t('identityPanel.cannotBeUndone.body2')}</p>
          </>
        ) : (
          <p className="mt-1">{t('identityPanel.provide.alreadyChosenNote')}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t('identityPanel.giveAsMuchAsYouWant')}</p>

        <Input label={t('identityPanel.fields.name')} value={identity.name} onChange={set('name')} autoComplete="off" />
        <Input
          label={t('identityPanel.fields.email')}
          type="email"
          value={identity.email}
          onChange={set('email')}
          autoComplete="off"
          hint={t('identityPanel.fields.emailHint')}
        />
        <Input label={t('identityPanel.fields.phone')} value={identity.phone} onChange={set('phone')} autoComplete="off" />
        <Input
          label={t('identityPanel.fields.jobTitle')}
          value={identity.jobTitle}
          onChange={set('jobTitle')}
          autoComplete="off"
        />
        <Textarea
          label={t('identityPanel.fields.notes')}
          value={identity.notes}
          onChange={set('notes')}
          rows={2}
        />

        {isUpgrade && (
          <Input
            label={t('identityPanel.fields.confirmLabel', { phrase: confirmPhrase })}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            className="font-mono tracking-wide"
            hint={t('identityPanel.fields.confirmHint')}
          />
        )}

        {status === 'error' && error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            loading={status === 'working'}
            loadingLabel={t('contactChannelPanel.form.saving')}
          >
            {t(`identityPanel.${copyKey}.submitLabel`)}
          </Button>
          <Button variant="ghost" onClick={resetForm}>
            {t(`identityPanel.${copyKey}.cancelLabel`)}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default IdentityPanel
