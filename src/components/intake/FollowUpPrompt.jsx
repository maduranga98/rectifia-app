import { useState } from 'react'
import { FOLLOW_UP_ANSWERS, FOLLOW_UP_STATUS, submitFollowUpResponse } from '../../services/followUpService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// The structured answers, in the order they are offered. Neutral and
// non-leading by design: "nothing has changed" comes first, and nothing here
// suggests retaliation is expected, likely, or common.
const OPTIONS = [
  { value: FOLLOW_UP_ANSWERS.NO_CHANGE, label: 'Nothing has changed' },
  { value: FOLLOW_UP_ANSWERS.CONCERN, label: 'Something has happened since I reported' },
  { value: FOLLOW_UP_ANSWERS.DECLINE, label: 'I would rather not answer' },
  { value: FOLLOW_UP_ANSWERS.STOP, label: 'Please stop asking me' },
]

const ANSWERED_LABEL = {
  [FOLLOW_UP_STATUS.ANSWERED_NO_CHANGE]: 'You answered: nothing has changed.',
  [FOLLOW_UP_STATUS.ANSWERED_CONCERN]: 'You answered: something has happened.',
  [FOLLOW_UP_STATUS.DECLINED]: 'You chose not to answer this check-in.',
  [FOLLOW_UP_STATUS.NO_RESPONSE]: 'This check-in was not answered.',
}

// The one-off notice posted into the thread after a retaliation case is filed.
// It shows the new Case ID only - the passcode is shown once, separately, at
// the moment of filing and is never stored here.
function NewCaseNotice({ followUp }) {
  return (
    <Alert variant="info" title="A separate case was opened">
      <p className="text-sm">
        New case <strong>{followUp.newCaseId}</strong>.{' '}
        {followUp.linked
          ? 'You chose to link it to this case, so its handler will know the same person filed both.'
          : 'It is standalone and carries no reference to this case.'}
      </p>
    </Alert>
  )
}

// The reporter-facing follow-up prompt, rendered inline in the case thread.
// `interactive` is true only in reporter mode (Case ID + passcode); an
// investigator viewing the thread sees the prompt and its status but cannot
// answer on the reporter's behalf.
function FollowUpPrompt({ caseId, passcode, followUp, interactive, onAnswered }) {
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
      <Alert variant="success" title="Your new case has been opened">
        <p className="text-sm">
          Case ID <strong>{filed.newCaseId}</strong>
        </p>
        <p className="mt-1 text-sm">
          Passcode <strong className="font-mono">{filed.newPasscode}</strong>
        </p>
        <p className="mt-2 text-xs">
          Save both now. This passcode is shown only once and cannot be recovered. It is separate
          from your existing case passcode.
          {filed.linked
            ? ' You chose to link this to your earlier case.'
            : ' This case is standalone and does not reference your earlier case.'}
        </p>
      </Alert>
    )
  }

  return (
    <div className="rounded-lg border border-line border-l-4 border-l-low bg-surface p-3.5 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-low">
        <Icon name="shield" className="h-3.5 w-3.5" />
        Follow-up check-in
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-charcoal">{followUp?.text ?? ''}</p>

      {answered ? (
        <p className="mt-2 text-xs text-muted">{ANSWERED_LABEL[followUp.status] ?? 'Answered.'}</p>
      ) : !interactive ? (
        <p className="mt-2 text-xs text-muted">Awaiting the reporter’s response.</p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2.5">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">Your answer</legend>
            {OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-charcoal">
                <input
                  type="radio"
                  name={`followup-${followUp.index}`}
                  value={option.value}
                  checked={answer === option.value}
                  onChange={() => setAnswer(option.value)}
                  className="h-4 w-4"
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          {isConcern && (
            <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas p-3">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Anything you would like to add (optional)
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  rows={3}
                  className="field resize-y text-sm"
                  placeholder="Only shared if you choose to open a new case below."
                />
              </label>

              <label className="flex items-start gap-2 text-sm text-charcoal">
                <input
                  type="checkbox"
                  checked={wantsToFile}
                  onChange={(e) => setWantsToFile(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Open a new, separate case about this. Your earlier case stays closed and
                  unchanged.
                </span>
              </label>

              {wantsToFile && (
                <label className="flex items-start gap-2 pl-6 text-sm text-charcoal">
                  <input
                    type="checkbox"
                    checked={linkToOriginal}
                    onChange={(e) => setLinkToOriginal(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    Link it to this case. If you tick this, the new case’s handler will know the
                    same person filed the earlier case. Leave it unticked and the new case is
                    completely standalone. This is your choice.
                  </span>
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
              loadingLabel="Sending"
              disabled={!answer}
            >
              {isConcern && wantsToFile ? 'Submit and open a new case' : 'Submit answer'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

export default FollowUpPrompt
