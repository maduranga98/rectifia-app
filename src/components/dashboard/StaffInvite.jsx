import { useEffect, useState } from 'react'
import { inviteStaff } from '../../services/staffService'
import { getCompany } from '../../services/companyService'
import { listCustomRoles } from '../../services/roleService'
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
  // Two mutually exclusive ways to assign access, mirroring the
  // "exactly one of role / customRoleId" invariant inviteStaff.js enforces
  // server-side: a fixed role picked from ASSIGNABLE_ROLES, or a custom role
  // built on RoleBuilder.jsx. Switching the type clears the other selection
  // rather than sending both.
  const [roleType, setRoleType] = useState('fixed')
  const [role, setRole] = useState(ASSIGNABLE_ROLES[0])
  const [customRoles, setCustomRoles] = useState([])
  const [customRoleId, setCustomRoleId] = useState('')
  const [companyDepartments, setCompanyDepartments] = useState([])
  const [selectedDepartments, setSelectedDepartments] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const isManager = roleType === 'fixed' && role === ROLES.MANAGER

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

  // Custom roles are Company Admin's own creations (RoleBuilder.jsx) - the
  // dropdown below can only ever offer one of those, never caseHandler or
  // hrCoordinator, because a custom role can never be composed with either
  // in the first place (see permissionModules.js's structural exclusion).
  useEffect(() => {
    let cancelled = false
    listCustomRoles(companyId)
      .then((rows) => {
        if (!cancelled) {
          setCustomRoles(rows)
          setCustomRoleId((current) => current || rows[0]?.id || '')
        }
      })
      .catch(() => {
        if (!cancelled) setCustomRoles([])
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
    if (roleType === 'custom' && !customRoleId) {
      setError('Choose a custom role, or create one on the Custom roles page first.')
      return
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await inviteStaff({
        companyId,
        email: email.trim(),
        ...(roleType === 'custom' ? { customRoleId } : { role }),
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
            label="Role type"
            value={roleType}
            hint="A fixed role, or a custom role built on the Custom roles page."
            onChange={(e) => setRoleType(e.target.value)}
          >
            <option value="fixed">Fixed role</option>
            <option value="custom">Custom role</option>
          </Select>
        </div>

        {roleType === 'fixed' ? (
          <Select label="Role" value={role} hint={ROLE_HINTS[role]} onChange={(e) => setRole(e.target.value)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        ) : customRoles.length === 0 ? (
          <Alert variant="warning">
            No custom roles exist yet. Create one on the Custom roles page before inviting someone into
            it.
          </Alert>
        ) : (
          <Select
            label="Custom role"
            value={customRoleId}
            hint="Case Handler and HR Coordinator can never appear here - they aren't composable."
            onChange={(e) => setCustomRoleId(e.target.value)}
          >
            {customRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        )}

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
          disabled={!email.trim() || (roleType === 'custom' && !customRoleId)}
        >
          Send invite
        </Button>
      </form>
    </Card>
  )
}

export default StaffInvite
