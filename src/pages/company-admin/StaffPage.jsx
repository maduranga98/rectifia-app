import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { listStaff, updateStaffStatus } from '../../services/routingService'
import { getCompany } from '../../services/companyService'
import { removeStaffMember, updateStaffDepartments } from '../../services/staffService'
import { assignStaffRole, listCustomRoles } from '../../services/roleService'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES, ROLE_LABELS } from '../../constants/roles'
import StaffInvite from '../../components/dashboard/StaffInvite'
import RoleBuilder from '../../components/dashboard/RoleBuilder'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

function initials(member) {
  const source = member.name ?? member.email ?? member.id
  return source.slice(0, 2).toUpperCase()
}

// The fixed roles assignStaffRole will actually accept (see
// ASSIGNABLE_FIXED_ROLES in functions/src/roles/assignStaffRole.js) -
// companyAdmin is deliberately absent: it is issued only at company setup,
// never re-assigned to an existing staff member through this callable.
const ASSIGNABLE_FIXED_ROLES = [ROLES.HR_COORDINATOR, ROLES.CASE_HANDLER, ROLES.MANAGER, ROLES.PULSE_CHECK_REVIEWER]

// Roster + status management for companies/{companyId}/staff. Never reads
// cases/caseMetadata - per Module 2, Company Admin gets structure/people
// settings only, never case content.
// inviteStaff, assignStaffRole, and removeStaffMember are all hard-gated on
// claims.role === 'companyAdmin' server-side (see
// functions/src/staff/inviteStaff.js, functions/src/roles/assignStaffRole.js,
// functions/src/staff/removeStaffMember.js) - a staffManagement permission
// holder can update status/department/jobTitle only (firestore.rules), never
// issue an invite, change a role, or remove an account. This is presentation
// only: hiding these entry points so the page never offers a control that
// would always be refused server-side.
//
// The "Custom roles" tab follows the same rule and for the same reason
// RoleBuilder itself must never be reachable by a staffManagement holder: a
// custom role is built from PERMISSION_MODULE_KEYS, and staffManagement is
// one of those keys, so a staffManagement holder who could create or edit
// roles could grant themselves (or anyone) any other permission in the
// allowlist - a self-escalation path Module 32 exists specifically to close.
// createCustomRole/updateCustomRole/deleteCustomRole/seedDefaultCustomRoles
// are hard-gated to companyAdmin server-side regardless, but the tab is kept
// out of reach here too rather than offering a control that always fails.
function StaffPage({ companyId, initialTab = 'roster' }) {
  const { t } = useTranslation()
  const { role } = useAuth()
  const isCompanyAdmin = role === ROLES.COMPANY_ADMIN
  const [activeTab, setActiveTab] = useState(initialTab === 'roles' && isCompanyAdmin ? 'roles' : 'roster')
  const [staff, setStaff] = useState([])
  const [customRoles, setCustomRoles] = useState([])
  const [companyDepartments, setCompanyDepartments] = useState([])
  const [showInvite, setShowInvite] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState(null)
  // The staff id currently being department-edited, plus the working selection.
  const [editingId, setEditingId] = useState(null)
  const [editSelection, setEditSelection] = useState([])
  // The staff id currently being role-edited, plus the working selection.
  // `role` and `customRoleId` are mutually exclusive, mirroring exactly what
  // assignStaffRole requires server-side - selecting one clears the other.
  const [roleEditingId, setRoleEditingId] = useState(null)
  const [roleEditSelection, setRoleEditSelection] = useState({ role: '', customRoleId: '' })
  // The staff id whose destructive removal confirm is currently open.
  const [removingId, setRemovingId] = useState(null)

  const customRoleNames = Object.fromEntries(customRoles.map((r) => [r.id, r.name]))

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [staffRows, company, customRoleRows] = await Promise.all([
        listStaff(companyId),
        getCompany(companyId),
        listCustomRoles(companyId),
      ])
      setStaff(staffRows)
      setCompanyDepartments(company?.departments ?? [])
      setCustomRoles(customRoleRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const activeAdminCount = staff.filter(
    (s) => s.role === ROLES.COMPANY_ADMIN && (s.status ?? 'active') !== 'suspended'
  ).length

  function isLastActiveAdmin(member) {
    const suspended = (member.status ?? 'active') === 'suspended'
    return member.role === ROLES.COMPANY_ADMIN && !suspended && activeAdminCount <= 1
  }

  async function handleToggleStatus(member) {
    const current = member.status ?? 'active'
    if (isLastActiveAdmin(member)) {
      setError(t('staffPage.cannotSuspendLastAdmin'))
      return
    }
    setError(null)
    setPendingId(member.id)
    try {
      await updateStaffStatus(companyId, member.id, current === 'suspended' ? 'active' : 'suspended')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  function startEditDepartments(member) {
    setError(null)
    setRoleEditingId(null)
    setRemovingId(null)
    setEditingId(member.id)
    setEditSelection(Array.isArray(member.departments) ? member.departments : [])
  }

  function toggleEditDepartment(name) {
    setEditSelection((current) =>
      current.includes(name) ? current.filter((d) => d !== name) : [...current, name]
    )
  }

  async function handleSaveDepartments(member) {
    setError(null)
    setPendingId(member.id)
    try {
      await updateStaffDepartments({ companyId, staffId: member.id, departments: editSelection })
      setEditingId(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  function startEditRole(member) {
    setError(null)
    setEditingId(null)
    setRemovingId(null)
    setRoleEditingId(member.id)
    setRoleEditSelection({
      role: member.role ?? '',
      customRoleId: member.customRoleId ?? '',
    })
  }

  async function handleSaveRole(member) {
    if (isLastActiveAdmin(member)) {
      setError(t('staffPage.cannotMoveLastAdmin'))
      return
    }
    const { role: selectedRole, customRoleId } = roleEditSelection
    if (!selectedRole && !customRoleId) {
      setError(t('staffPage.chooseARole'))
      return
    }
    setError(null)
    setPendingId(member.id)
    try {
      await assignStaffRole({
        companyId,
        staffId: member.id,
        role: selectedRole || undefined,
        customRoleId: customRoleId || undefined,
      })
      setRoleEditingId(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  async function handleRemove(member) {
    setError(null)
    setPendingId(member.id)
    try {
      await removeStaffMember({ companyId, staffId: member.id })
      setRemovingId(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  const inviteButton = isCompanyAdmin ? (
    <Button
      variant={showInvite ? 'secondary' : 'primary'}
      icon={showInvite ? 'close' : 'plus'}
      onClick={() => setShowInvite((v) => !v)}
    >
      {showInvite ? t('common.cancel') : t('staffPage.inviteStaff')}
    </Button>
  ) : null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {isCompanyAdmin && (
        <div className="flex gap-1 border-b border-line-soft">
          {[
            { id: 'roster', label: t('staffPage.tabs.roster') },
            { id: 'roles', label: t('staffPage.tabs.roles') },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-navy text-charcoal'
                  : 'border-transparent text-muted hover:text-charcoal'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'roles' && isCompanyAdmin ? (
        <RoleBuilder companyId={companyId} />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="max-w-xl text-sm text-muted">{t('staffPage.description')}</p>
            {inviteButton}
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          {isCompanyAdmin && showInvite && (
            <StaffInvite
              companyId={companyId}
              onInvited={() => {
                setShowInvite(false)
                refresh()
              }}
            />
          )}

          {loading && staff.length === 0 ? (
            <SkeletonList rows={4} />
          ) : (
            <Card
              title={t('staffPage.teamMembers')}
              description={t('staffPage.memberCount', { count: staff.length })}
              padded={false}
            >
              {staff.length === 0 ? (
                <EmptyState
                  icon="staff"
                  title={t('staffPage.empty.title')}
                  description={t('staffPage.empty.description')}
                  action={inviteButton}
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {staff.map((s) => {
                    const status = s.status ?? 'active'
                    const suspended = status === 'suspended'
                    const lastActiveAdmin = isLastActiveAdmin(s)
                    const isManager = s.role === ROLES.MANAGER
                    const assignedDepartments = Array.isArray(s.departments) ? s.departments : []
                    const editingDepartments = editingId === s.id
                    const editingRole = roleEditingId === s.id
                    const confirmingRemove = removingId === s.id

                    return (
                      <li key={s.id} className="flex flex-col gap-3 px-5 py-3.5 hover:bg-navy-50/40">
                        <div className="flex flex-wrap items-center gap-3">
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                              suspended ? 'bg-line-soft text-muted' : 'bg-navy text-white'
                            }`}
                            aria-hidden="true"
                          >
                            {initials(s)}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-sm font-medium ${suspended ? 'text-muted' : 'text-charcoal'}`}>
                              {s.name ?? s.email ?? s.id}
                            </p>
                            {s.name && s.email && <p className="truncate text-xs text-muted">{s.email}</p>}
                          </div>

                          <Badge tone="tone-info">
                            {s.role
                              ? t(`roles.${s.role}`, { defaultValue: ROLE_LABELS[s.role] ?? s.role })
                              : customRoleNames[s.customRoleId] ?? t('staffPage.customRole')}
                          </Badge>
                          <Badge tone={suspended ? 'tone-critical' : 'tone-low'} dot>
                            {suspended ? t('staffPage.suspended') : t('staffPage.active')}
                          </Badge>

                          {isManager && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => (editingDepartments ? setEditingId(null) : startEditDepartments(s))}
                              disabled={pendingId === s.id}
                            >
                              {editingDepartments ? t('common.cancel') : t('staffPage.editDepartments')}
                            </Button>
                          )}

                          {isCompanyAdmin && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => (editingRole ? setRoleEditingId(null) : startEditRole(s))}
                              disabled={pendingId === s.id}
                            >
                              {editingRole ? t('common.cancel') : t('staffPage.changeRole')}
                            </Button>
                          )}

                          <Button
                            variant={suspended ? 'secondary' : 'dangerGhost'}
                            size="sm"
                            onClick={() => handleToggleStatus(s)}
                            disabled={lastActiveAdmin || pendingId === s.id}
                            title={lastActiveAdmin ? t('staffPage.cannotSuspendLastAdmin') : undefined}
                          >
                            {suspended ? t('staffPage.reactivate') : t('staffPage.suspend')}
                          </Button>

                          {isCompanyAdmin && (
                            <Button
                              variant="dangerGhost"
                              size="sm"
                              onClick={() => (confirmingRemove ? setRemovingId(null) : setRemovingId(s.id))}
                              disabled={pendingId === s.id}
                            >
                              {t('staffPage.remove')}
                            </Button>
                          )}
                        </div>

                        {isManager && !editingDepartments && (
                          <div className="flex flex-wrap items-center gap-1.5 pl-12">
                            <span className="text-xs text-muted">{t('staffPage.pulseScope')}</span>
                            {assignedDepartments.length === 0 ? (
                              <span className="text-xs font-medium text-high">
                                {t('staffPage.noDepartmentsAssigned')}
                              </span>
                            ) : (
                              assignedDepartments.map((name) => (
                                <Badge key={name} tone="tone-neutral">
                                  {name}
                                </Badge>
                              ))
                            )}
                          </div>
                        )}

                        {isManager && editingDepartments && (
                          <div className="flex flex-col gap-2 pl-12">
                            {companyDepartments.length === 0 ? (
                              <p className="text-xs text-muted">{t('staffPage.noDepartmentsConfigured')}</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {companyDepartments.map((dept) => {
                                  const checked = editSelection.includes(dept.name)
                                  return (
                                    <label
                                      key={dept.id ?? dept.name}
                                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                                        checked
                                          ? 'border-navy bg-navy-50 text-charcoal'
                                          : 'border-line-soft text-muted'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleEditDepartment(dept.name)}
                                        className="h-4 w-4"
                                      />
                                      {dept.name}
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                            <div>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleSaveDepartments(s)}
                                loading={pendingId === s.id}
                                loadingLabel={t('staffPage.saving')}
                              >
                                {t('staffPage.saveDepartments')}
                              </Button>
                            </div>
                          </div>
                        )}

                        {editingRole && (
                          <div className="flex flex-col gap-3 pl-12">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Select
                                label={t('staffPage.fixedRole')}
                                value={roleEditSelection.role}
                                onChange={(e) =>
                                  setRoleEditSelection({ role: e.target.value, customRoleId: '' })
                                }
                              >
                                <option value="">{t('staffPage.none')}</option>
                                {ASSIGNABLE_FIXED_ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {t(`roles.${r}`, { defaultValue: ROLE_LABELS[r] })}
                                  </option>
                                ))}
                              </Select>
                              <Select
                                label={t('staffPage.customRoleLabel')}
                                value={roleEditSelection.customRoleId}
                                onChange={(e) =>
                                  setRoleEditSelection({ role: '', customRoleId: e.target.value })
                                }
                              >
                                <option value="">{t('staffPage.none')}</option>
                                {customRoles.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </Select>
                            </div>
                            <p className="text-xs text-muted">{t('staffPage.chooseOneRoleHint')}</p>
                            <div>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleSaveRole(s)}
                                loading={pendingId === s.id}
                                loadingLabel={t('staffPage.saving')}
                                disabled={!roleEditSelection.role && !roleEditSelection.customRoleId}
                              >
                                {t('staffPage.saveRole')}
                              </Button>
                            </div>
                          </div>
                        )}

                        {confirmingRemove && (
                          <div className="flex flex-col gap-3 rounded-lg border border-critical-200 bg-critical/5 p-3 pl-12">
                            <p className="text-sm text-charcoal">
                              <Trans
                                i18nKey="staffPage.removeConfirm.body"
                                values={{ name: s.name ?? s.email ?? s.id }}
                                components={{ strong: <strong /> }}
                              />
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleRemove(s)}
                                loading={pendingId === s.id}
                                loadingLabel={t('staffPage.removing')}
                              >
                                {t('staffPage.removeConfirm.button')}
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => setRemovingId(null)}>
                                {t('common.cancel')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}

export default StaffPage
