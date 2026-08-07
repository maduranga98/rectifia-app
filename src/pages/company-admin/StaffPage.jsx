import { useCallback, useEffect, useState } from 'react'
import { listStaff, updateStaffStatus } from '../../services/routingService'
import { getCompany } from '../../services/companyService'
import { updateStaffDepartments } from '../../services/staffService'
import { listCustomRoles } from '../../services/roleService'
import { ROLES, ROLE_LABELS } from '../../constants/roles'
import StaffInvite from '../../components/dashboard/StaffInvite'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { SkeletonList } from '../../components/ui/Loading'

function initials(member) {
  const source = member.name ?? member.email ?? member.id
  return source.slice(0, 2).toUpperCase()
}

// Roster + status management for companies/{companyId}/staff. Never reads
// cases/caseMetadata - per Module 2, Company Admin gets structure/people
// settings only, never case content.
function StaffPage({ companyId }) {
  const [staff, setStaff] = useState([])
  const [customRoleNames, setCustomRoleNames] = useState({})
  const [companyDepartments, setCompanyDepartments] = useState([])
  const [showInvite, setShowInvite] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState(null)
  // The staff id currently being department-edited, plus the working selection.
  const [editingId, setEditingId] = useState(null)
  const [editSelection, setEditSelection] = useState([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [staffRows, company, customRoles] = await Promise.all([
        listStaff(companyId),
        getCompany(companyId),
        listCustomRoles(companyId),
      ])
      setStaff(staffRows)
      setCompanyDepartments(company?.departments ?? [])
      setCustomRoleNames(Object.fromEntries(customRoles.map((r) => [r.id, r.name])))
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

  async function handleToggleStatus(member) {
    const current = member.status ?? 'active'
    const isLastActiveAdmin = member.role === ROLES.COMPANY_ADMIN && current !== 'suspended' && activeAdminCount <= 1
    if (isLastActiveAdmin) {
      setError('Cannot suspend the last active Company Admin')
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

  const inviteButton = (
    <Button
      variant={showInvite ? 'secondary' : 'primary'}
      icon={showInvite ? 'close' : 'plus'}
      onClick={() => setShowInvite((v) => !v)}
    >
      {showInvite ? 'Cancel' : 'Invite staff'}
    </Button>
  )

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          Everyone with access to your Rectifia workspace. Suspending a member revokes their
          sign-in without removing their history.
        </p>
        {inviteButton}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {showInvite && (
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
          title="Team members"
          description={`${staff.length} member${staff.length === 1 ? '' : 's'}`}
          padded={false}
        >
          {staff.length === 0 ? (
            <EmptyState
              icon="staff"
              title="No staff yet"
              description="Invite HR coordinators, case handlers, and managers so cases can be routed and worked."
              action={inviteButton}
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {staff.map((s) => {
                const status = s.status ?? 'active'
                const suspended = status === 'suspended'
                const isLastActiveAdmin =
                  s.role === ROLES.COMPANY_ADMIN && !suspended && activeAdminCount <= 1
                const isManager = s.role === ROLES.MANAGER
                const assignedDepartments = Array.isArray(s.departments) ? s.departments : []
                const editing = editingId === s.id

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
                        {s.role ? ROLE_LABELS[s.role] ?? s.role : customRoleNames[s.customRoleId] ?? 'Custom role'}
                      </Badge>
                      <Badge tone={suspended ? 'tone-critical' : 'tone-low'} dot>
                        {suspended ? 'Suspended' : 'Active'}
                      </Badge>

                      {isManager && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => (editing ? setEditingId(null) : startEditDepartments(s))}
                          disabled={pendingId === s.id}
                        >
                          {editing ? 'Cancel' : 'Edit departments'}
                        </Button>
                      )}

                      <Button
                        variant={suspended ? 'secondary' : 'dangerGhost'}
                        size="sm"
                        onClick={() => handleToggleStatus(s)}
                        disabled={isLastActiveAdmin || pendingId === s.id}
                        title={isLastActiveAdmin ? 'Cannot suspend the last active Company Admin' : undefined}
                      >
                        {suspended ? 'Reactivate' : 'Suspend'}
                      </Button>
                    </div>

                    {isManager && !editing && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-12">
                        <span className="text-xs text-muted">Pulse scope:</span>
                        {assignedDepartments.length === 0 ? (
                          <span className="text-xs font-medium text-high">
                            No departments assigned - this manager sees no pulse results
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

                    {isManager && editing && (
                      <div className="flex flex-col gap-2 pl-12">
                        {companyDepartments.length === 0 ? (
                          <p className="text-xs text-muted">
                            No departments are configured. Add departments on the Departments page
                            first.
                          </p>
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
                            loadingLabel="Saving"
                          >
                            Save departments
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
    </div>
  )
}

export default StaffPage
