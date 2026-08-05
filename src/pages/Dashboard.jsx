import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, ROLE_LABELS } from '../constants/roles'
import AppShell from '../components/shared/AppShell'
import HRCoordinatorDashboard from '../components/dashboard/HRCoordinatorDashboard'
import HandlerDashboard from '../components/investigation/HandlerDashboard'
import CaseDetailView from '../components/investigation/CaseDetailView'
import PulseTrendDashboard from '../components/pulse-check/PulseTrendDashboard'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'

// Which views each role actually gets. This mirrors the role design the
// Cloud Functions and firestore.rules already enforce - it is a navigation
// map, not an access control layer: hiding a nav item here stops nothing,
// the underlying reads are what a wrong role gets denied on.
const VIEWS_BY_ROLE = {
  [ROLES.HR_COORDINATOR]: [
    { id: 'cases', label: 'Case oversight', icon: 'cases' },
    { id: 'pulse', label: 'Pulse checks', icon: 'pulse' },
  ],
  [ROLES.CASE_HANDLER]: [{ id: 'myCases', label: 'My cases', icon: 'cases' }],
  [ROLES.MANAGER]: [{ id: 'pulse', label: 'Team wellness', icon: 'pulse' }],
  [ROLES.PULSE_CHECK_REVIEWER]: [{ id: 'pulse', label: 'Pulse checks', icon: 'pulse' }],
  // Company Admin has no view here at all: its whole surface is the settings
  // panel on /admin, and RootRedirect sends it straight to /admin/overview on
  // sign-in, so it never lands on /dashboard through the normal flow.
}

// Renders the dashboard each staff role is entitled to. These components
// (HRCoordinatorDashboard, HandlerDashboard, PulseTrendDashboard) were all
// already built but were not rendered on any route, which is why signing in
// as staff previously showed nothing but a heading.
function Dashboard() {
  const { user, role, companyId, departments } = useAuth()
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
    if (!role) {
      return (
        <Alert variant="error" title="No role assigned">
          This account has no role assigned yet, so there is nothing to show. Ask your Company
          Admin to re-issue the invite.
        </Alert>
      )
    }

    if (!companyId) {
      return (
        <Alert variant="error" title="Account not linked to a company">
          This account is not linked to a company. Ask your Company Admin to re-issue the invite.
        </Alert>
      )
    }

    switch (activeView) {
      case 'cases':
        return <HRCoordinatorDashboard companyId={companyId} />
      case 'pulse':
        return <PulseTrendDashboard companyId={companyId} role={role} departments={departments} />
      case 'myCases':
        return selectedCaseId ? (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            <Button icon="back" onClick={() => setSelectedCaseId(null)} className="self-start">
              Back to my cases
            </Button>
            <CaseDetailView caseId={selectedCaseId} />
          </div>
        ) : (
          <HandlerDashboard onSelectCase={setSelectedCaseId} />
        )
      default:
        return (
          <Card padded={false} className="mx-auto max-w-2xl">
            <EmptyState
              title="Nothing to show yet"
              description={`No dashboard is configured for the ${ROLE_LABELS[role] ?? role} role yet.`}
            />
          </Card>
        )
    }
  }

  const activeLabel = views.find((v) => v.id === activeView)?.label

  return (
    <AppShell
      scopeLabel={role ? ROLE_LABELS[role] ?? role : 'Staff'}
      navItems={views}
      activeId={activeView}
      onSelect={(id) => {
        setActiveView(id)
        setSelectedCaseId(null)
      }}
      userEmail={user?.email}
      roleLabel={role ? ROLE_LABELS[role] ?? role : 'Staff'}
      onSignOut={handleSignOut}
      eyebrow="Dashboard"
      title={selectedCaseId ? 'Case detail' : activeLabel ?? 'Overview'}
    >
      {renderView()}
    </AppShell>
  )
}

export default Dashboard
