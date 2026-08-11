import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validateCaseAccess } from '../../services/caseAccessService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import { Input } from '../ui/Field'

// The reporter's way back into their own case: no account, just the Case ID
// and passcode issued at submission. Deliberately its own form rather than
// anything on the staff sign-in page - they are different systems.
function CaseAccess({ onAccessGranted, initialCaseId = '' }) {
  const { t } = useTranslation()
  const [caseId, setCaseId] = useState(initialCaseId.toUpperCase())
  const [passcode, setPasscode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await validateCaseAccess(caseId, passcode)
      if (!result.valid) {
        setError(t('caseAccess.errors.invalid'))
        return
      }
      // The passcode goes back to the caller too: the case thread
      // re-verifies with it on every poll, and this form is the only place
      // it is ever entered.
      onAccessGranted?.(result.case, passcode)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
      <Input
        label={t('caseAccess.caseId')}
        type="text"
        value={caseId}
        onChange={(e) => setCaseId(e.target.value.toUpperCase())}
        placeholder="RC-2026-8842"
        autoComplete="off"
        required
        className="font-mono tracking-wide"
      />

      <Input
        label={t('caseAccess.passcode')}
        type="password"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        autoComplete="off"
        required
        className="font-mono"
        hint={t('caseAccess.hint')}
      />

      {error && <Alert variant="error">{error}</Alert>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        loading={submitting}
        loadingLabel={t('caseAccess.checking')}
        disabled={!caseId || !passcode}
      >
        {t('caseAccess.accessCase')}
      </Button>
    </form>
  )
}

export default CaseAccess
