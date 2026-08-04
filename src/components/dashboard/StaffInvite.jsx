import { useState } from 'react'
import { inviteStaff } from '../../services/staffService'
import { auth } from '../../services/firebase'
import { ASSIGNABLE_ROLES, ROLE_LABELS } from '../../constants/roles'

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-charcoal">Invite staff</h3>

      <input
        type="email"
        required
        placeholder="name@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="field rounded px-3 py-2 text-sm"
      />

      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="field rounded px-3 py-2 text-sm"
      >
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>

      {error && <p className="text-sm text-critical">{error}</p>}
      {success && <p className="text-sm text-low">{success}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {submitting ? 'Sending invite...' : 'Send invite'}
      </button>
    </form>
  )
}

export default StaffInvite
