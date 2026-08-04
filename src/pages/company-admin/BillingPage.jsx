import { useCallback, useEffect, useState } from 'react'
import { getCompany } from '../../services/companyService'
import { listStaff } from '../../services/routingService'

// Read-only status display only - no payment form, no Stripe/payment
// integration here. Plan changes and billing mutations happen outside this
// module, same as the original CompanyAdminPanel note.
function BillingPage({ companyId }) {
  const [company, setCompany] = useState(null)
  const [employeeCount, setEmployeeCount] = useState(0)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [companyData, staffRows] = await Promise.all([getCompany(companyId), listStaff(companyId)])
      setCompany(companyData)
      setEmployeeCount(staffRows.filter((s) => (s.status ?? 'active') !== 'suspended').length)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  if (loading && !company) {
    return <p className="p-6 text-sm text-muted">Loading...</p>
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold text-charcoal">Subscription &amp; billing</h2>
      {error && <p className="text-sm text-critical">{error}</p>}

      <div className="flex flex-col gap-2 rounded border border-line bg-surface px-4 py-3 text-sm">
        <p>
          Plan: <span className="font-medium">{company?.subscriptionTier ?? 'Not set'}</span>
        </p>
        <p>
          Billing status: <span className="font-medium">{company?.billingStatus ?? 'Unknown'}</span>
        </p>
        <p>
          Cases this period: <span className="font-medium">{company?.currentPeriodCaseCount ?? 0}</span>
        </p>
        <p>
          Active staff: <span className="font-medium">{employeeCount}</span>
        </p>
        <p className="mt-2 text-xs text-muted">Read-only. Payment and plan changes are handled outside this panel.</p>
      </div>
    </div>
  )
}

export default BillingPage
