import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FOLLOW_UP_ANSWERS, FOLLOW_UP_STATUS, submitFollowUpResponse } from '../../services/followUpService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// The structured answers, in the order they are offered, and the translation
// key each status maps to. Neutral and non-leading by design: "nothing has
// changed" comes first, and nothing here suggests retaliation is expected,
// likely, or common.
const OPTION_VALUES = [
  { value: FOLLOW_UP_ANSWERS.NO_CHANGE, key: 'noChange' },
  { value: FOLLOW_UP_ANSWERS.CONCERN, key: 'concern' },
  { value: FOLLOW_UP_ANSWERS.DECLINE, key: 'decline' },
  { value: FOLLOW_UP_ANSWERS.STOP, key: 'stop' },
]

const ANSWERED_LABEL_KEY = {
  [FOLLOW_UP_STATUS.ANSWERED_NO_CHANGE]: 'answeredNoChange',
  [FOLLOW_UP_STATUS.ANSWERED_CONCERN]: 'answeredConcern',
  [FOLLOW_UP_STATUS.DECLINED]: 'declined',
  [FOLLOW_UP_STATUS.NO_RESPONSE]: 'noResponse',
}

// The one-off notice posted into the thread after a retaliation case is filed.
// It shows the new Case ID only - the passcode is shown once, separately, at
// the moment of filing and is never stored here.
function NewCaseNotice({ followUp }) {
  const { t } = useTranslation()
  return (
    <Alert variant="info" title={t('followUpPrompt.newCase.title')}>
      <p className="text-sm">
        {t('followUpPrompt.newCase.caseLabel', { caseId: followUp.newCaseId })}{' '}
        {followUp.linked ? t('followUpPrompt.newCase.linked') : t('followUpPrompt.newCase.standalone')}
      </p>
    </Alert>
  )
}

// The reporter-facing follow-up prompt, rendered inline in the case thread.
// `interactive` is true only in reporter mode (Case ID + passcode); an
// investigator viewing the thread sees the prompt and its status but cannot
// answer on the reporter's behalf.
function FollowUpPrompt({ caseId, passcode, followUp, interactive, onAnswered }) {
  const { t } = useTranslation()
  const [answer, setAnswer] = useState(null)
  const [freeText, setFreeText] = useState('')
  const [wantsToFile, setWantsToFile] = useState(false)
  const [linkToOriginal, setLinkToOriginal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [filed, setFiled] = useState(null)

  if (followUp?.kind === 'new_case') {
    return <NewCaseNotice followUp={followUp} />
  }

  const answered = followUp?.status && followUp.status !== FOLLOW_UP_STATUS.SENT
  const isConcern = answer === FOLLOW_UP_ANSWERS.CONCERN

  async function handleSubmit(event) {
    event.preventDefault()
    if (!answer) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await submitFollowUpResponse({
        caseId,
        passcode,
        answer,
        freeText: isConcern ? freeText : '',
        fileRetaliationCase: isConcern && wantsToFile,
        linkToOriginal: isConcern && wantsToFile && linkToOriginal,
      })
      if (result?.filed) {
        setFiled(result)
      }
      await onAnswered?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // After a case is filed, the passcode is shown exactly once - it cannot be
  // recovered, so this panel makes saving it the reporter's job before moving on.
  if (filed) {
    return (
      <Alert variant="success" title={t('followUpPrompt.filed.title')}>
        <p className="text-sm">{t('followUpPrompt.filed.caseId', { caseId: filed.newCaseId })}</p>
        <p className="mt-1 text-sm">
          {t('followUpPrompt.filed.passcodeLabel')}{' '}
          <strong className="font-mono">{filed.newPasscode}</strong>
        </p>
        <p className="mt-2 text-xs">
          {t('followUpPrompt.filed.saveNote')}
          {filed.linked ? t('followUpPrompt.filed.linked') : t('followUpPrompt.filed.standalone')}
        </p>
      </Alert>
    )
  }

  return (
    <div className="rounded-lg border border-line border-l-4 border-l-low bg-surface p-3.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-low">
        <Icon name="shield" className="h-3.5 w-3.5" />
        {t('followUpPrompt.title')}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-charcoal">{followUp?.text ?? ''}</p>

      {answered ? (
        <p className="mt-2 text-xs text-muted">
          {ANSWERED_LABEL_KEY[followUp.status]
            ? t(`followUpPrompt.answeredLabels.${ANSWERED_LABEL_KEY[followUp.status]}`)
            : t('followUpPrompt.answeredLabels.fallback')}
        </p>
      ) : !interactive ? (
        <p className="mt-2 text-xs text-muted">{t('followUpPrompt.awaitingResponse')}</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2.5">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">{t('followUpPrompt.yourAnswer')}</legend>
            {OPTION_VALUES.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-charcoal">
                <input
                  type="radio"
                  name={`followup-${followUp.index}`}
                  value={option.value}
                  checked={answer === option.value}
                  onChange={() => setAnswer(option.value)}
                  className="h-4 w-4"
                />
                {t(`followUpPrompt.options.${option.key}`)}
              </label>
            ))}
          </fieldset>

          {isConcern && (
            <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas p-3">
              <label className="flex flex-col gap-1 text-xs text-muted">
                {t('followUpPrompt.addAnything')}
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  rows={3}
                  className="field resize-y text-sm"
                  placeholder={t('followUpPrompt.addAnythingPlaceholder')}
                />
              </label>

              <label className="flex items-start gap-2 text-sm text-charcoal">
                <input
                  type="checkbox"
                  checked={wantsToFile}
                  onChange={(e) => setWantsToFile(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>{t('followUpPrompt.openNewCase')}</span>
              </label>

              {wantsToFile && (
                <label className="flex items-start gap-2 pl-6 text-sm text-charcoal">
                  <input
                    type="checkbox"
                    checked={linkToOriginal}
                    onChange={(e) => setLinkToOriginal(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>{t('followUpPrompt.linkToOriginal')}</span>
                </label>
              )}
            </div>
          )}

          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submitting}
              loadingLabel={t('caseThread.sending')}
              disabled={!answer}
            >
              {isConcern && wantsToFile
                ? t('followUpPrompt.submitAndOpenCase')
                : t('followUpPrompt.submitAnswer')}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

export default FollowUpPrompt
