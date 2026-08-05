import { useEffect, useState } from 'react'
import { inviteStaff } from '../../services/staffService'
import { getCompany } from '../../services/companyService'
import { auth } from '../../services/firebase'
import { ASSIGNABLE_ROLES, ROLES, ROLE_LABELS } from '../../constants/roles'
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
  const [companyDepartments, setCompanyDepartments] = useState([])
  const [selectedDepartments, setSelectedDepartments] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const isManager = role === ROLES.MANAGER

  // A manager's pulse visibility is scoped to their department(s), so the
  // company's configured departments are offered as a multi-select. The names
  // picked here become the manager's `departments` claim verbatim.
  useEffect(() => {
    let cancelled = false
    getCompany(companyId)
      .then((company) => {
        if (!cancelled) setCompanyDepartments(company?.departments ?? [])
      })
      .catch(() => {
        if (!cancelled) setCompanyDepartments([])
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  function toggleDepartment(name) {
    setSelectedDepartments((current) =>
      current.includes(name) ? current.filter((d) => d !== name) : [...current, name]
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await inviteStaff({
        companyId,
        email: email.trim(),
        role,
        actorId: auth.currentUser?.uid,
        departments: isManager ? selectedDepartments : undefined,
      })
      setSuccess(`Invite sent to ${email.trim()}`)
      setEmail('')
      setSelectedDepartments([])
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

        {isManager && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-charcoal">Departments</legend>
            <p className="text-xs text-muted">
              A manager only sees aggregate pulse results for the departments assigned here. Names
              must match the department as it appears on employee records.
            </p>
            {companyDepartments.length === 0 ? (
              <Alert variant="warning">
                No departments are configured yet. Add departments on the Departments page before
                inviting a manager, or invite them now and assign departments from the staff list
                later.
              </Alert>
            ) : (
              <div className="flex flex-wrap gap-2">
                {companyDepartments.map((dept) => {
                  const checked = selectedDepartments.includes(dept.name)
                  return (
                    <label
                      key={dept.id ?? dept.name}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        checked ? 'border-navy bg-navy-50 text-charcoal' : 'border-line-soft text-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDepartment(dept.name)}
                        className="h-4 w-4"
                      />
                      {dept.name}
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>
        )}

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
