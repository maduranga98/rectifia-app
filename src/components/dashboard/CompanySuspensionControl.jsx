import { useState } from 'react'
import { setCompanySuspended } from '../../services/companyService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import { Input } from '../ui/Field'

// Super Admin's suspend/reactivate tool - the one control for blocking a
// company's new-case intake (functions/src/intake/submitCase.js and
// createCaseOnBehalf.js both refuse to file a case while `suspended` is
// true) without touching anything that already exists: existing cases,
// staff accounts, and employee data are all left exactly as they were, and
// every dashboard the company's own staff already had access to keeps
// working. Typical reasons are non-payment or an offboarding request -
// deliberately separate from billingStatus, which mirrors Stripe's own
// subscription state and is locked against manual writes.
function CompanySuspensionControl({ company, onChanged }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const suspended = company?.suspended === true

  async function handleSuspend(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await setCompanySuspended(company.id, true, reason)
      setReason('')
      await onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReactivate() {
    setError(null)
    setSubmitting(true)
    try {
      await setCompanySuspended(company.id, false)
      await onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (suspended) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="warning" title="Suspended">
          New case submissions are blocked for this company. Existing cases, staff, and employee
          data are untouched.
          {company.suspendedReason && (
            <p className="mt-1 text-xs">Reason: {company.suspendedReason}</p>
          )}
        </Alert>
        {error && <Alert variant="error">{error}</Alert>}
        <div>
          <Button variant="accent" onClick={handleReactivate} loading={submitting} loadingLabel="Reactivating...">
            Reactivate company
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSuspend} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Suspending blocks new case submissions immediately - through the reporting link and staff
        intake alike. Nothing existing is deleted or hidden, and this can be reversed any time.
      </p>
      <Input
        label="Reason (optional)"
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. non-payment, offboarding"
      />
      {error && <Alert variant="error">{error}</Alert>}
      <div>
        <Button type="submit" variant="dangerGhost" loading={submitting} loadingLabel="Suspending...">
          Suspend company
        </Button>
      </div>
    </form>
  )
}

export default CompanySuspensionControl
