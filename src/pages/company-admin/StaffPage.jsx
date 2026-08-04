import { useCallback, useEffect, useState } from 'react'
import { listStaff, updateStaffStatus } from '../../services/routingService'
import { ROLES, ROLE_LABELS } from '../../constants/roles'
import StaffInvite from '../../components/dashboard/StaffInvite'

// Roster + status management for companies/{companyId}/staff. Never reads
// cases/caseMetadata - per Module 2, Company Admin gets structure/people
// settings only, never case content.
function StaffPage({ companyId }) {
  const [staff, setStaff] = useState([])
  const [showInvite, setShowInvite] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

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

  const activeAdminCount = staff.filter((s) => s.role === ROLES.COMPANY_ADMIN && (s.status ?? 'active') !== 'suspended').length

  async function handleToggleStatus(member) {
    const current = member.status ?? 'active'
    const isLastActiveAdmin = member.role === ROLES.COMPANY_ADMIN && current !== 'suspended' && activeAdminCount <= 1
    if (isLastActiveAdmin) {
      setError('Cannot suspend the last active Company Admin')
      return
    }
    setError(null)
    try {
      await updateStaffStatus(companyId, member.id, current === 'suspended' ? 'active' : 'suspended')
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading && staff.length === 0) {
    return <p className="p-6 text-sm text-muted">Loading...</p>
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-charcoal">Staff</h2>
        <button type="button" onClick={() => setShowInvite((v) => !v)} className="btn-primary rounded px-4 py-2 text-sm font-medium">
          {showInvite ? 'Close' : 'Invite staff'}
        </button>
      </div>
      {error && <p className="text-sm text-critical">{error}</p>}

      {showInvite && (
        <StaffInvite
          companyId={companyId}
          onInvited={() => {
            setShowInvite(false)
            refresh()
          }}
        />
      )}

      <ul className="flex flex-col gap-2 text-sm">
        {staff.map((s) => {
          const status = s.status ?? 'active'
          const isLastActiveAdmin = s.role === ROLES.COMPANY_ADMIN && status !== 'suspended' && activeAdminCount <= 1
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-line bg-surface px-3 py-2">
              <span className="font-medium">{s.name ?? s.email ?? s.id}</span>
              <span className="text-xs text-muted">{s.email}</span>
              <span className="text-xs text-muted">{ROLE_LABELS[s.role] ?? s.role}</span>
              <span className={`text-xs ${status === 'suspended' ? 'text-critical' : 'text-muted'}`}>{status}</span>
              <button
                type="button"
                onClick={() => handleToggleStatus(s)}
                disabled={isLastActiveAdmin}
                title={isLastActiveAdmin ? 'Cannot suspend the last active Company Admin' : undefined}
                className="ml-auto text-xs text-navy underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
              >
                {status === 'suspended' ? 'Reactivate' : 'Suspend'}
              </button>
            </li>
          )
        })}
        {staff.length === 0 && <li className="text-sm text-muted">No staff yet.</li>}
      </ul>
    </div>
  )
}

export default StaffPage
