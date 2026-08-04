import { useState } from 'react'
import { inviteStaff } from '../../services/staffService'
import { auth } from '../../services/firebase'
import { ASSIGNABLE_ROLES, ROLE_LABELS } from '../../constants/roles'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { Input, Select } from '../ui/Field'

// What each role can actually do, said in the form rather than left to the
// admin's memory - picking the wrong role here is the difference between
// someone seeing case content and not.
const ROLE_HINTS = {
  companyAdmin: 'Settings, staff, and routing. Never sees case content.',
  hrCoordinator: 'Company-wide case oversight and reassignment.',
  caseHandler: 'Investigates the cases assigned to them.',
  manager: 'Aggregate team wellbeing only.',
  pulseCheckReviewer: 'Individual pulse check responses.',
}

// Company Admin enters an email + role; the actual account creation, custom
// claim, and set-your-password link all happen server-side
// (functions/src/staff/inviteStaff.js) - this form never sees or handles a
// password.
function StaffInvite({ companyId, onInvited }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(ASSIGNABLE_ROLES[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await inviteStaff({ companyId, email: email.trim(), role, actorId: auth.currentUser?.uid })
      setSuccess(`Invite sent to ${email.trim()}`)
      setEmail('')
      onInvited?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card
      title="Invite a team member"
      description="They receive a link to set their own password - no password is handled here."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Work email"
            type="email"
            required
            autoComplete="off"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            label="Role"
            value={role}
            hint={ROLE_HINTS[role]}
            onChange={(e) => setRole(e.target.value)}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Button
          type="submit"
          variant="primary"
          icon="mail"
          className="self-start"
          loading={submitting}
          loadingLabel="Sending invite"
          disabled={!email.trim()}
        >
          Send invite
        </Button>
      </form>
    </Card>
  )
}

export default StaffInvite
