import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, ROLE_LABELS } from '../constants/roles'
import { useCompanyCases } from '../hooks/useCompanyCases'
import AppShell from '../components/shared/AppShell'
import Alert from '../components/ui/Alert'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import HROverviewPage from './staff/HROverviewPage'
import HRCasesPage from './staff/HRCasesPage'
import HRTriagePage from './staff/HRTriagePage'
import PatternsPage from './staff/PatternsPage'
import FollowUpsPage from './staff/FollowUpsPage'
import MyCasesPage from './staff/MyCasesPage'
import CaseWorkspacePage from './staff/CaseWorkspacePage'
import PulseResponsesPage from './staff/PulseResponsesPage'
import PulseTrendsPage from './staff/PulseTrendsPage'
import BenchmarkPage from './staff/BenchmarkPage'
import StaffIntake from './StaffIntake'
import AnalyticsDashboard from '../components/dashboard/AnalyticsDashboard'

// Which nav each staff role gets. This replaces the old VIEWS_BY_ROLE state
// switch: every capability now has its own nav entry and its own URL, so a
// staff surface is bookmarkable and shareable rather than a hidden in-page tab.
// This is a navigation map, not an access-control layer - hiding a nav item
// stops nothing; the callables and firestore.rules are the enforcement layer,
// and a role reads exactly what it read before regardless of what is listed
// here. "File a report" links to /dashboard/intake, a page that was previously
// only reachable as a button buried inside two dashboards.
//
// companyAdmin has no entry here at all: its whole surface is /admin, and
// RootRedirect sends it straight to /admin/overview on sign-in.
const NAV_BY_ROLE = {
  [ROLES.HR_COORDINATOR]: [
    { to: '/dashboard/overview', label: 'Overview', icon: 'overview' },
    { to: '/dashboard/cases', label: 'All cases', icon: 'cases' },
    { to: '/dashboard/triage', label: 'Awaiting triage', icon: 'inbox' },
    { to: '/dashboard/patterns', label: 'Patterns', icon: 'sparkle' },
    { to: '/dashboard/follow-ups', label: 'Follow-ups', icon: 'clock' },
    { to: '/dashboard/pulse-responses', label: 'Pulse checks', icon: 'pulse' },
    { to: '/dashboard/trends', label: 'Trends', icon: 'overview' },
    { to: '/dashboard/benchmark', label: 'Benchmark', icon: 'overview' },
    { to: '/dashboard/analytics', label: 'Analytics', icon: 'sparkle' },
    { to: '/dashboard/intake', label: 'File a report', icon: 'plus' },
  ],
  [ROLES.CASE_HANDLER]: [
    { to: '/dashboard/my-cases', label: 'My cases', icon: 'cases' },
    { to: '/dashboard/analytics', label: 'Analytics', icon: 'sparkle' },
    { to: '/dashboard/intake', label: 'File a report', icon: 'plus' },
  ],
  [ROLES.PULSE_CHECK_REVIEWER]: [
    { to: '/dashboard/pulse-responses', label: 'Pulse responses', icon: 'pulse' },
    { to: '/dashboard/trends', label: 'Trends', icon: 'overview' },
  ],
  [ROLES.MANAGER]: [{ to: '/dashboard/wellness', label: 'Team wellness', icon: 'pulse' }],
}

// The first /dashboard page a role is entitled to - where the index route and
// any unentitled path both land, rather than an empty shell. Every nav entry is
// now a /dashboard/* path, so the first one is always this landing page.
function indexPathFor(navItems) {
  return navItems.find((item) => item.to.startsWith('/dashboard/'))?.to ?? '/dashboard'
}

function titleFor(pathname, navItems) {
  if (/^\/dashboard\/cases\/[^/]+/.test(pathname)) return 'Case workspace'
  const match = navItems.find((item) => pathname.startsWith(item.to))
  return match?.label ?? 'Dashboard'
}

// The nested route table for each role - the presentation counterpart of what
// that role can already read. A path a role is not entitled to falls through to
// the catch-all and redirects to that role's index.
function DashboardRoutes({ role, companyId, departments, companyCases }) {
  const index = indexPathFor(NAV_BY_ROLE[role] ?? [])
  const toIndex = <Navigate to={index} replace />

  if (role === ROLES.HR_COORDINATOR) {
    return (
      <Routes>
        <Route index element={toIndex} />
        <Route path="overview" element={<HROverviewPage {...companyCases} />} />
        <Route path="cases" element={<HRCasesPage companyId={companyId} {...companyCases} />} />
        <Route path="triage" element={<HRTriagePage companyId={companyId} {...companyCases} />} />
        <Route path="patterns" element={<PatternsPage companyId={companyId} />} />
        <Route path="follow-ups" element={<FollowUpsPage {...companyCases} />} />
        <Route path="pulse-responses" element={<PulseResponsesPage companyId={companyId} />} />
        <Route path="trends" element={<PulseTrendsPage companyId={companyId} role={role} />} />
        <Route path="benchmark" element={<BenchmarkPage companyId={companyId} />} />
        <Route path="analytics" element={<AnalyticsDashboard companyId={companyId} canExport />} />
        <Route path="intake" element={<StaffIntake />} />
        <Route path="*" element={toIndex} />
      </Routes>
    )
  }

  if (role === ROLES.CASE_HANDLER) {
    return (
      <Routes>
        <Route index element={toIndex} />
        <Route path="my-cases" element={<MyCasesPage />} />
        <Route path="cases/:caseId/*" element={<CaseWorkspacePage />} />
        {/* Aggregate stats only - firestore.rules opens companies/{companyId}/
            analytics/* to caseHandler with the same access as companyAdmin/
            hrCoordinator, but the export button stays off (canExport
            defaults false): there is no per-handler breakdown in this
            collection for a Case Handler to see, and offline PDF export is
            reserved for the two board/audit-facing roles. */}
        <Route path="analytics" element={<AnalyticsDashboard companyId={companyId} />} />
        <Route path="intake" element={<StaffIntake />} />
        <Route path="*" element={toIndex} />
      </Routes>
    )
  }

  if (role === ROLES.PULSE_CHECK_REVIEWER) {
    return (
      <Routes>
        <Route index element={toIndex} />
        <Route path="pulse-responses" element={<PulseResponsesPage companyId={companyId} />} />
        <Route path="trends" element={<PulseTrendsPage companyId={companyId} role={role} />} />
        <Route path="*" element={toIndex} />
      </Routes>
    )
  }

  if (role === ROLES.MANAGER) {
    return (
      <Routes>
        <Route index element={toIndex} />
        <Route
          path="wellness"
          element={<PulseTrendsPage companyId={companyId} role={role} departments={departments} />}
        />
        <Route path="*" element={toIndex} />
      </Routes>
    )
  }

  return (
    <Card padded={false} className="mx-auto max-w-2xl">
      <EmptyState
        title="Nothing to show yet"
        description={`No dashboard is configured for the ${ROLE_LABELS[role] ?? role} role yet.`}
      />
    </Card>
  )
}

// The staff dashboard: owns the AppShell chrome and a nested <Routes> table,
// exactly as Admin.jsx does for the Company Admin surface. The active nav item
// and the page title are derived from the URL, not from useState - a case a
// handler is working now lives at its own route, so there is no selectedCaseId
// or activeView held here at all.
function Dashboard() {
  const { user, role, companyId, departments } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // A Company Admin's entire surface is /admin; it has no /dashboard nav and no
  // /dashboard routes, so a typed or bookmarked /dashboard/* path would fall
  // through to the empty shell. Send it to /admin/overview, matching the
  // reasoning in RootRedirect, rather than giving companyAdmin a NAV_BY_ROLE
  // entry - the Company Admin surface is /admin and must stay there.
  if (role === ROLES.COMPANY_ADMIN) {
    return <Navigate to="/admin/overview" replace />
  }

  const navItems = NAV_BY_ROLE[role] ?? []

  // One shared load of the company case metadata for the HR Coordinator's
  // pages, kept here so it survives navigation between them. Inert for every
  // other role.
  const companyCases = useCompanyCases(companyId, { enabled: role === ROLES.HR_COORDINATOR })

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  function renderBody() {
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
    return (
      <DashboardRoutes
        role={role}
        companyId={companyId}
        departments={departments}
        companyCases={companyCases}
      />
    )
  }

  return (
    <AppShell
      scopeLabel={role ? ROLE_LABELS[role] ?? role : 'Staff'}
      navItems={navItems}
      userEmail={user?.email}
      roleLabel={role ? ROLE_LABELS[role] ?? role : 'Staff'}
      onSignOut={handleSignOut}
      eyebrow="Dashboard"
      title={titleFor(location.pathname, navItems)}
    >
      {renderBody()}
    </AppShell>
  )
}

export default Dashboard
