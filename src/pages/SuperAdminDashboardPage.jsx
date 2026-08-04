import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listCompanies } from '../services/companyService'
import { signOutUser } from '../services/authService'
import CompanySetup from '../components/dashboard/CompanySetup'
import AppHeader from '../components/shared/AppHeader'

// Per Module 2's no-case-content-access rule, this reads only company-level
// metadata (name, subscriptionTier, case-count) from the `companies` doc -
// it must never query or display anything from `cases`, `caseMetadata`, or
// a messages/questionnaire subcollection.
//
// Registering a company is a Super Admin action and this is the only place
// it happens: the CompanySetup form below already existed but was not
// rendered anywhere, so there was no path in the app to onboard a company.
function SuperAdminDashboardPage() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [notice, setNotice] = useState(null)
  const navigate = useNavigate()

  const loadCompanies = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setCompanies(await listCompanies())
    } catch (err) {
      setError(err.message || 'Could not load companies')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCompanies()
  }, [loadCompanies])

  async function handleCreated() {
    setShowRegisterForm(false)
    setNotice('Company registered.')
    await loadCompanies()
  }

  async function handleSignOut() {
    await signOutUser()
    navigate('/super-admin/login', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Rectifia"
        subtitle="Lumora platform administration"
        actions={
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-navy-600 px-3 py-1.5 text-sm text-white hover:bg-navy-800"
          >
            Sign out
          </button>
        }
      />

      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold">Platform overview</h1>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-charcoal">Companies</h2>
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setShowRegisterForm((open) => !open)
            }}
            className={`rounded px-3 py-1.5 text-sm font-semibold ${
              showRegisterForm ? 'btn-secondary' : 'btn-accent'
            }`}
          >
            {showRegisterForm ? 'Close' : 'Register company'}
          </button>
        </div>

        {showRegisterForm && (
          <div className="rounded-lg border border-line bg-surface p-4">
            <CompanySetup
              title="Register a company"
              onCreated={handleCreated}
              onCancel={() => setShowRegisterForm(false)}
            />
          </div>
        )}

        {notice && <p className="text-sm text-low">{notice}</p>}
        {loading && <p className="text-sm text-muted">Loading companies...</p>}
        {error && <p className="text-sm text-critical">{error}</p>}
        {!loading && !error && companies.length === 0 && (
          <p className="text-sm text-muted">
            No companies yet. Use &quot;Register company&quot; to onboard the first one.
          </p>
        )}

        {!loading && companies.length > 0 && (
          <div className="flex flex-col gap-2">
            {companies.map((company) => (
              <div key={company.id} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
                <p className="text-sm font-medium text-charcoal">{company.name}</p>
                <p className="text-sm text-muted">Plan: {company.subscriptionTier ?? 'Unknown'}</p>
                <p className="text-sm text-muted">
                  Jurisdictions: {company.jurisdictions?.join(', ') || '—'}
                </p>
                <p className="text-sm text-muted">
                  Cases this period: {company.currentPeriodCaseCount ?? '—'}
                </p>
                <p className="text-sm text-muted">Billing status: {company.billingStatus ?? 'Unknown'}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SuperAdminDashboardPage
