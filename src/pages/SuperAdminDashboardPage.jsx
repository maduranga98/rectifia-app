import { useEffect, useState } from 'react'
import { listCompanies } from '../services/companyService'

// Minimal placeholder landing page. Per Module 2's no-case-content-access
// rule, this reads only company-level metadata (name, subscriptionTier,
// case-count) from the `companies` doc - it must never query or display
// anything from `cases`, `caseMetadata`, or a messages/questionnaire
// subcollection.
function SuperAdminDashboardPage() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function loadCompanies() {
      try {
        const result = await listCompanies()
        if (!cancelled) setCompanies(result)
      } catch (err) {
        if (!cancelled) setError('Could not load companies')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadCompanies()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold">Platform overview</h1>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Companies</h2>

        {loading && <p className="text-sm text-gray-500">Loading companies...</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && companies.length === 0 && (
          <p className="text-sm text-gray-500">No companies yet.</p>
        )}

        {!loading && companies.length > 0 && (
          <div className="flex flex-col gap-2">
            {companies.map((company) => (
              <div key={company.id} className="flex flex-col gap-1 rounded border border-gray-200 p-4">
                <p className="text-sm font-medium text-gray-900">{company.name}</p>
                <p className="text-sm text-gray-600">Plan: {company.subscriptionTier ?? 'Unknown'}</p>
                <p className="text-sm text-gray-600">
                  Cases this period: {company.currentPeriodCaseCount ?? '—'}
                </p>
                <p className="text-sm text-gray-600">Billing status: {company.billingStatus ?? 'Unknown'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SuperAdminDashboardPage
