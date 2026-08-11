import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
    : t('deletionRequestPanel.recently')

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
    <Alert variant="warning" title={t('deletionRequestPanel.title')}>
      <div className="flex flex-col gap-3">
        <p>{t('deletionRequestPanel.body', { date: requestedAtLabel })}</p>

        {onHold && (
          <Alert variant="error">{t('deletionRequestPanel.onHold')}</Alert>
        )}

        {!action ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={onHold}
              onClick={() => setAction('approve')}
            >
              {t('deletionRequestPanel.reviewToApprove')}
            </Button>
            <Button variant="secondary" onClick={() => setAction('decline')}>
              {t('deletionRequestPanel.reviewToDecline')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Textarea
              label={action === 'approve' ? t('deletionRequestPanel.approveReasonLabel') : t('deletionRequestPanel.declineReasonLabel')}
              rows={3}
              placeholder={
                action === 'approve'
                  ? t('deletionRequestPanel.approveReasonPlaceholder')
                  : t('deletionRequestPanel.declineReasonPlaceholder')
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
                  {t('deletionRequestPanel.continue')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAction(null)
                    setReason('')
                  }}
                  disabled={submitting}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            )}

            {action === 'approve' && confirmingApprove && (
              <Alert variant="error" title={t('deletionRequestPanel.confirmModal.title')}>
                <p>{t('deletionRequestPanel.confirmModal.body', { caseId: caseData.caseId ?? caseData.id })}</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="danger"
                    onClick={handleApprove}
                    loading={submitting}
                    loadingLabel={t('deletionRequestPanel.deleting')}
                  >
                    {t('deletionRequestPanel.confirmModal.confirm')}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingApprove(false)} disabled={submitting}>
                    {t('deletionRequestPanel.back')}
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
                  loadingLabel={t('deletionRequestPanel.saving')}
                >
                  {t('deletionRequestPanel.declineRequest')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAction(null)
                    setReason('')
                  }}
                  disabled={submitting}
                >
                  {t('common.cancel')}
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
