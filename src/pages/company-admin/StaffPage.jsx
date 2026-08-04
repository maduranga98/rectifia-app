import { useCallback, useEffect, useState } from 'react'
import { listStaff, updateStaffStatus } from '../../services/routingService'
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
  const [showInvite, setShowInvite] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStaff(await listStaff(companyId))
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

                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-navy-50/40">
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

                    <Badge tone="tone-info">{ROLE_LABELS[s.role] ?? s.role}</Badge>
                    <Badge tone={suspended ? 'tone-critical' : 'tone-low'} dot>
                      {suspended ? 'Suspended' : 'Active'}
                    </Badge>

                    <Button
                      variant={suspended ? 'secondary' : 'dangerGhost'}
                      size="sm"
                      onClick={() => handleToggleStatus(s)}
                      disabled={isLastActiveAdmin || pendingId === s.id}
                      title={isLastActiveAdmin ? 'Cannot suspend the last active Company Admin' : undefined}
                    >
                      {suspended ? 'Reactivate' : 'Suspend'}
                    </Button>
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
