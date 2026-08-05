import { useState } from 'react'
import { approveDeletionRequest, declineDeletionRequest } from '../../services/retentionService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import { Textarea } from '../ui/Field'

// Mirrors the reason-length floor functions/src/retention/deletionRequest.js
// enforces server-side (requireReason). Duplicated purely to gate the button
// and message the requirement, the same pattern handlerService.js's
// MIN_REASON_LENGTH uses for identity reveal.
const MIN_REASON_LENGTH = 10

// Shown in the assigned Case Handler's workspace whenever
// caseData.deletionRequested.status is 'pending' - a reporter has asked, via
// the Case ID + passcode they hold, for this case to be permanently deleted.
// Approving is immediate and irreversible (functions/src/retention/
// deletionRequest.js's approveDeletionRequest hard-deletes the case's content
// there and then, the same way a Tier 2 retention sweep would); declining
// leaves the case untouched. Both require a written reason, and both are
// logged to deletionLog - this is a decision, not a formality.
function DeletionRequestPanel({ caseData, onChanged, onDeleted }) {
  const [reason, setReason] = useState('')
  const [action, setAction] = useState(null) // 'approve' | 'decline' | null
  const [confirmingApprove, setConfirmingApprove] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (caseData.deletionRequested?.status !== 'pending') return null

  const onHold = caseData.legalHold?.active === true
  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH
  const requestedAt = caseData.deletionRequested?.at?.toMillis?.()
  const requestedAtLabel = requestedAt
    ? new Date(requestedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'recently'

  async function handleApprove() {
    if (!reasonValid) return
    setSubmitting(true)
    setError(null)
    try {
      await approveDeletionRequest(caseData.id, reason.trim())
      // The case document is gone after this - there is nothing left to
      // refresh, so the caller navigates away instead.
      await onDeleted?.()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
      setConfirmingApprove(false)
    }
  }

  async function handleDecline() {
    if (!reasonValid) return
    setSubmitting(true)
    setError(null)
    try {
      await declineDeletionRequest(caseData.id, reason.trim())
      setReason('')
      setAction(null)
      await onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Alert variant="warning" title="This reporter has requested deletion of this case">
      <div className="flex flex-col gap-3">
        <p>
          Requested {requestedAtLabel}. Approving permanently and immediately deletes this case&apos;s
          content - the narrative, messages, questionnaire answers, and any evidence files. This
          cannot be undone. Declining leaves the case exactly as it is.
        </p>

        {onHold && (
          <Alert variant="error">
            This case is under legal hold. It cannot be approved for deletion until the hold is
            released.
          </Alert>
        )}

        {!action ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={onHold}
              onClick={() => setAction('approve')}
            >
              Review to approve
            </Button>
            <Button variant="secondary" onClick={() => setAction('decline')}>
              Review to decline
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Textarea
              label={action === 'approve' ? 'Reason for approving deletion' : 'Reason for declining deletion'}
              rows={3}
              placeholder={
                action === 'approve'
                  ? 'Record why this case qualifies for erasure (min. 10 characters).'
                  : 'Record why this case must be retained despite the request (min. 10 characters).'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            {action === 'approve' && !confirmingApprove && (
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  disabled={!reasonValid}
                  onClick={() => setConfirmingApprove(true)}
                >
                  Continue
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAction(null)
                    setReason('')
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </div>
            )}

            {action === 'approve' && confirmingApprove && (
              <Alert variant="error" title="Permanently delete this case?">
                <p>
                  This will immediately and irreversibly delete the case narrative, messages,
                  questionnaire answers and evidence for case {caseData.caseId ?? caseData.id}. There is
                  no undo.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="danger"
                    onClick={handleApprove}
                    loading={submitting}
                    loadingLabel="Deleting"
                  >
                    Yes, permanently delete
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingApprove(false)} disabled={submitting}>
                    Back
                  </Button>
                </div>
              </Alert>
            )}

            {action === 'decline' && (
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={!reasonValid}
                  onClick={handleDecline}
                  loading={submitting}
                  loadingLabel="Saving"
                >
                  Decline request
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAction(null)
                    setReason('')
                  }}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </Alert>
  )
}

export default DeletionRequestPanel
