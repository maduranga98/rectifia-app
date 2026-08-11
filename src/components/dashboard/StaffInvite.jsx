import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { inviteStaff } from '../../services/staffService'
import { getCompany } from '../../services/companyService'
import { listCustomRoles } from '../../services/roleService'
import { auth } from '../../services/firebase'
import { ASSIGNABLE_ROLES, ROLES, ROLE_LABELS } from '../../constants/roles'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { Input, Select } from '../ui/Field'

// Company Admin enters an email + role; the actual account creation, custom
// claim, and set-your-password link all happen server-side
// (functions/src/staff/inviteStaff.js) - this form never sees or handles a
// password.
function StaffInvite({ companyId, onInvited }) {
  const { t } = useTranslation()
  // What each role can actually do, said in the form rather than left to the
  // admin's memory - picking the wrong role here is the difference between
  // someone seeing case content and not.
  const ROLE_HINTS = {
    companyAdmin: t('staffInvite.roleHints.companyAdmin'),
    hrCoordinator: t('staffInvite.roleHints.hrCoordinator'),
    caseHandler: t('staffInvite.roleHints.caseHandler'),
    manager: t('staffInvite.roleHints.manager'),
    pulseCheckReviewer: t('staffInvite.roleHints.pulseCheckReviewer'),
  }
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
      setError(t('staffInvite.chooseCustomRole'))
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
      setSuccess(t('staffInvite.inviteSent', { email: email.trim() }))
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
      title={t('staffInvite.title')}
      description={t('staffInvite.description')}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('staffInvite.workEmail')}
            type="email"
            required
            autoComplete="off"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            label={t('staffInvite.roleType')}
            value={roleType}
            hint={t('staffInvite.roleTypeHint')}
            onChange={(e) => setRoleType(e.target.value)}
          >
            <option value="fixed">{t('staffInvite.fixedRole')}</option>
            <option value="custom">{t('staffInvite.customRole')}</option>
          </Select>
        </div>

        {roleType === 'fixed' ? (
          <Select label={t('staffInvite.role')} value={role} hint={ROLE_HINTS[role]} onChange={(e) => setRole(e.target.value)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`, { defaultValue: ROLE_LABELS[r] })}
              </option>
            ))}
          </Select>
        ) : customRoles.length === 0 ? (
          <Alert variant="warning">{t('staffInvite.noCustomRoles')}</Alert>
        ) : (
          <Select
            label={t('staffInvite.customRole')}
            value={customRoleId}
            hint={t('staffInvite.customRoleHint')}
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
            <legend className="text-sm font-medium text-charcoal">{t('staffInvite.departmentsLegend')}</legend>
            <p className="text-xs text-muted">{t('staffInvite.departmentsHint')}</p>
            {companyDepartments.length === 0 ? (
              <Alert variant="warning">{t('staffInvite.noDepartments')}</Alert>
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
          loadingLabel={t('staffInvite.sending')}
          disabled={!email.trim() || (roleType === 'custom' && !customRoleId)}
        >
          {t('staffInvite.sendInvite')}
        </Button>
      </form>
    </Card>
  )
}

export default StaffInvite
