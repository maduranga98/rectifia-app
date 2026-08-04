import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listCompanies } from '../services/companyService'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import CompanySetup from '../components/dashboard/CompanySetup'
import ManualAssignmentQueue from '../components/dashboard/ManualAssignmentQueue'
import AppShell from '../components/shared/AppShell'
import Alert from '../components/ui/Alert'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import StatTile from '../components/ui/StatTile'
import { SkeletonList } from '../components/ui/Loading'

const BILLING_TONE = {
  active: 'tone-low',
  trialing: 'tone-info',
  past_due: 'tone-critical',
  canceled: 'tone-critical',
  unpaid: 'tone-critical',
}

// Per Module 2's no-case-content-access rule, the companies view reads only
// company-level metadata (name, subscriptionTier, case-count) from the
// `companies` doc, and the manual-assignment queue below reads only
// caseMetadata/{caseId} - the metadata-only mirror, narrowed by
// firestore.rules to the two manual-assignment reasons only the platform can
// resolve (conflict_of_interest, missing_company_id). Neither ever touches
// `cases`, a messages subcollection, or questionnaire responses.
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
  const [section, setSection] = useState('companies')
  const [manualAssignmentCount, setManualAssignmentCount] = useState(null)
  const navigate = useNavigate()
  const { user } = useAuth()

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

  const totalCases = companies.reduce((sum, c) => sum + (c.currentPeriodCaseCount ?? 0), 0)
  const attentionCount = companies.filter(
    (c) => c.billingStatus && !['active', 'trialing'].includes(c.billingStatus)
  ).length

  const registerButton = (
    <Button
      variant={showRegisterForm ? 'secondary' : 'accent'}
      icon={showRegisterForm ? 'close' : 'plus'}
      onClick={() => {
        setNotice(null)
        setShowRegisterForm((open) => !open)
      }}
    >
      {showRegisterForm ? 'Cancel' : 'Register company'}
    </Button>
  )

  const isCompanies = section === 'companies'

  return (
    <AppShell
      scopeLabel="Lumora platform"
      navItems={[
        { id: 'companies', label: 'Companies', icon: 'company' },
        { id: 'manualAssignment', label: 'Manual assignment', icon: 'routing' },
      ]}
      activeId={section}
      onSelect={setSection}
      userEmail={user?.email}
      roleLabel="Super Admin"
      onSignOut={handleSignOut}
      eyebrow="Platform administration"
      title={isCompanies ? 'Companies' : 'Manual assignment'}
      headerActions={isCompanies ? registerButton : null}
    >
      {/* The queue stays mounted across sections so its count is available to
          the stat tile on the companies view - switching sections shouldn't
          re-run the query, and a Super Admin shouldn't have to open the
          section to find out something is waiting there. */}
      <div className={isCompanies ? 'hidden' : 'mx-auto flex max-w-5xl flex-col gap-6'}>
        <ManualAssignmentQueue
          companies={companies}
          onCountChange={setManualAssignmentCount}
        />
      </div>

      <div className={isCompanies ? 'mx-auto flex max-w-5xl flex-col gap-6' : 'hidden'}>
        {notice && <Alert variant="success">{notice}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Companies" value={companies.length} tone="tone-info" icon="company" />
          <StatTile
            label="Cases this period"
            hint="Across every tenant"
            value={totalCases}
            tone="tone-neutral"
            icon="cases"
          />
          <StatTile
            label="Billing needs attention"
            value={attentionCount}
            tone={attentionCount > 0 ? 'tone-critical' : 'tone-low'}
            icon="billing"
          />
          <StatTile
            label="Needs manual assignment"
            hint="Conflicts of interest and cases with no company"
            value={manualAssignmentCount ?? '—'}
            tone={manualAssignmentCount > 0 ? 'tone-high' : 'tone-low'}
            icon="routing"
          />
        </div>

        {showRegisterForm && (
          <Card title="Register a company">
            <CompanySetup
              title={null}
              onCreated={handleCreated}
              onCancel={() => setShowRegisterForm(false)}
            />
          </Card>
        )}

        {loading && companies.length === 0 ? (
          <SkeletonList rows={3} />
        ) : companies.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon="company"
              title="No companies yet"
              description="Register the first tenant to create its Company Admin account and open the workspace."
              action={registerButton}
            />
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {companies.map((company) => (
              <Card key={company.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-charcoal">{company.name}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted">
                      {company.subscriptionTier ?? 'Plan unknown'}
                    </p>
                  </div>
                  <Badge tone={BILLING_TONE[company.billingStatus] ?? 'tone-neutral'} dot>
                    {(company.billingStatus ?? 'unknown').replace(/_/g, ' ')}
                  </Badge>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Jurisdictions</dt>
                    <dd className="mt-0.5 font-medium text-charcoal">
                      {company.jurisdictions?.join(', ') || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Cases this period</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-charcoal">
                      {company.currentPeriodCaseCount ?? '—'}
                    </dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default SuperAdminDashboardPage
