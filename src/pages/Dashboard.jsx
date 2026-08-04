import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, ROLE_LABELS } from '../constants/roles'
import AppHeader from '../components/shared/AppHeader'
import HRCoordinatorDashboard from '../components/dashboard/HRCoordinatorDashboard'
import HandlerDashboard from '../components/investigation/HandlerDashboard'
import CaseDetailView from '../components/investigation/CaseDetailView'
import PulseTrendDashboard from '../components/pulse-check/PulseTrendDashboard'

// Which views each role actually gets. This mirrors the role design the
// Cloud Functions and firestore.rules already enforce - it is a navigation
// map, not an access control layer: hiding a tab here stops nothing, the
// underlying reads are what a wrong role gets denied on.
const VIEWS_BY_ROLE = {
  [ROLES.HR_COORDINATOR]: [
    { id: 'cases', label: 'Case oversight' },
    { id: 'pulse', label: 'Pulse checks' },
  ],
  [ROLES.CASE_HANDLER]: [{ id: 'myCases', label: 'My cases' }],
  [ROLES.MANAGER]: [{ id: 'pulse', label: 'Team wellness' }],
  [ROLES.PULSE_CHECK_REVIEWER]: [{ id: 'pulse', label: 'Pulse checks' }],
  // Company Admin's whole surface is the settings panel on /admin, so it
  // gets a link there rather than a tab of its own.
  [ROLES.COMPANY_ADMIN]: [],
}

// Renders the dashboard each staff role is entitled to. These components
// (HRCoordinatorDashboard, HandlerDashboard, PulseTrendDashboard) were all
// already built but were not rendered on any route, which is why signing in
// as staff previously showed nothing but a heading.
function Dashboard() {
  const { role, companyId } = useAuth()
  const navigate = useNavigate()
  const views = VIEWS_BY_ROLE[role] ?? []
  const [activeView, setActiveView] = useState(views[0]?.id ?? null)
  // Case Handlers open a case inline rather than at /case/:caseId - that
  // route is the anonymous reporter's tracking page, a different view of a
  // case entirely.
  const [selectedCaseId, setSelectedCaseId] = useState(null)

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  function renderView() {
    if (role === ROLES.COMPANY_ADMIN) {
      return (
        <div className="mx-auto max-w-5xl p-6">
          <p className="text-sm text-muted">
            Company Admin tools - departments, staff, routing rules, and
            billing - live in company settings.
          </p>
          <Link
            to="/admin"
            className="btn-primary mt-4 inline-block rounded px-4 py-2 text-sm font-medium"
          >
            Open company settings
          </Link>
        </div>
      )
    }

    if (!role) {
      return (
        <div className="mx-auto max-w-5xl p-6">
          <p className="text-sm text-critical">
            This account has no role assigned yet, so there is nothing to show.
            Ask your Company Admin to re-issue the invite.
          </p>
        </div>
      )
    }

    if (!companyId) {
      return (
        <div className="mx-auto max-w-5xl p-6">
          <p className="text-sm text-critical">
            This account is not linked to a company. Ask your Company Admin to
            re-issue the invite.
          </p>
        </div>
      )
    }

    switch (activeView) {
      case 'cases':
        return <HRCoordinatorDashboard companyId={companyId} />
      case 'pulse':
        return <PulseTrendDashboard companyId={companyId} role={role} />
      case 'myCases':
        return selectedCaseId ? (
          <div className="mx-auto max-w-3xl px-6 pt-6">
            <button
              type="button"
              onClick={() => setSelectedCaseId(null)}
              className="text-sm text-navy underline"
            >
              Back to my cases
            </button>
            <CaseDetailView caseId={selectedCaseId} />
          </div>
        ) : (
          <HandlerDashboard onSelectCase={setSelectedCaseId} />
        )
      default:
        return (
          <div className="mx-auto max-w-5xl p-6">
            <p className="text-sm text-muted">
              No dashboard is configured for the {ROLE_LABELS[role] ?? role}{' '}
              role yet.
            </p>
          </div>
        )
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Rectifia"
        subtitle={role ? ROLE_LABELS[role] ?? role : 'Staff'}
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

      {views.length > 1 && (
        <nav className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-5xl gap-1 px-6">
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => {
                  setActiveView(view.id)
                  setSelectedCaseId(null)
                }}
                className={`border-b-2 px-3 py-3 text-sm font-medium ${
                  activeView === view.id
                    ? 'border-navy text-charcoal'
                    : 'border-transparent text-muted hover:text-charcoal'
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {renderView()}
    </div>
  )
}

export default Dashboard
