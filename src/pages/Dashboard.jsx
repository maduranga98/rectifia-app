import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, ROLE_LABELS } from '../constants/roles'
import { useCompanyCases } from '../hooks/useCompanyCases'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
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
import DesignatedHandlersPage from './company-admin/DesignatedHandlersPage'
import HelpSupportPage from './shared/HelpSupportPage'

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
// Some entries carry a `flag`: the per-company feature flag key
// (src/config/featureFlags.js) that must be on for this nav item - and the
// route behind it - to be reachable. Dashboard filters navItems by these
// before handing them to AppShell, and DashboardRoutes applies the same
// flags to the matching <Route>, so a direct URL hit is redirected the same
// way an unentitled role's URL already is - hiding the nav link alone would
// leave the route itself reachable by anyone who still had it bookmarked.
// `labelKey` is a dashboardNav.* translation key rather than a literal label -
// AppShell renders whatever `label` a caller hands it, so the labels are
// resolved with `t()` when navItems is built below, not stored here.
const NAV_BY_ROLE = {
  [ROLES.HR_COORDINATOR]: [
    { to: '/dashboard/overview', labelKey: 'dashboardNav.overview', icon: 'overview' },
    { to: '/dashboard/cases', labelKey: 'dashboardNav.allCases', icon: 'cases' },
    { to: '/dashboard/triage', labelKey: 'dashboardNav.awaitingTriage', icon: 'inbox' },
    { to: '/dashboard/patterns', labelKey: 'dashboardNav.patterns', icon: 'sparkle', flag: 'patternDetection' },
    { to: '/dashboard/follow-ups', labelKey: 'dashboardNav.followUps', icon: 'clock' },
    { to: '/dashboard/pulse-responses', labelKey: 'dashboardNav.pulseChecks', icon: 'pulse', flag: 'pulseCheck' },
    { to: '/dashboard/trends', labelKey: 'dashboardNav.trends', icon: 'overview', flag: 'pulseCheck' },
    { to: '/dashboard/benchmark', labelKey: 'dashboardNav.benchmark', icon: 'overview', flag: 'benchmarkPool' },
    { to: '/dashboard/analytics', labelKey: 'dashboardNav.analytics', icon: 'sparkle' },
    { to: '/dashboard/intake', labelKey: 'dashboardNav.fileAReport', icon: 'plus' },
    { to: '/dashboard/help', labelKey: 'dashboardNav.help', icon: 'help' },
  ],
  [ROLES.CASE_HANDLER]: [
    { to: '/dashboard/my-cases', labelKey: 'dashboardNav.myCases', icon: 'cases' },
    { to: '/dashboard/analytics', labelKey: 'dashboardNav.analytics', icon: 'sparkle' },
    { to: '/dashboard/intake', labelKey: 'dashboardNav.fileAReport', icon: 'plus' },
    // Self-service view of JP's designated-handler register - see
    // DesignatedHandlersPage.jsx. Always shown: a Case Handler may hold a
    // designation (or need to acknowledge one) regardless of whether their
    // company currently has JP configured.
    { to: '/dashboard/designation', labelKey: 'dashboardNav.myDesignation', icon: 'shield' },
    { to: '/dashboard/help', labelKey: 'dashboardNav.help', icon: 'help' },
  ],
  [ROLES.PULSE_CHECK_REVIEWER]: [
    { to: '/dashboard/pulse-responses', labelKey: 'dashboardNav.pulseResponses', icon: 'pulse', flag: 'pulseCheck' },
    { to: '/dashboard/trends', labelKey: 'dashboardNav.trends', icon: 'overview', flag: 'pulseCheck' },
    { to: '/dashboard/help', labelKey: 'dashboardNav.help', icon: 'help' },
  ],
  [ROLES.MANAGER]: [
    { to: '/dashboard/wellness', labelKey: 'dashboardNav.teamWellness', icon: 'pulse', flag: 'pulseCheck' },
    { to: '/dashboard/help', labelKey: 'dashboardNav.help', icon: 'help' },
  ],
}

function filterNavByFlags(navItems, flags) {
  return navItems.filter((item) => !item.flag || flags[item.flag] !== false)
}

// The first /dashboard page a role is entitled to - where the index route and
// any unentitled path both land, rather than an empty shell. Every nav entry is
// now a /dashboard/* path, so the first one is always this landing page.
function indexPathFor(navItems) {
  return navItems.find((item) => item.to.startsWith('/dashboard/'))?.to ?? '/dashboard'
}

function titleFor(pathname, navItems, t) {
  if (/^\/dashboard\/cases\/[^/]+/.test(pathname)) return t('dashboardNav.caseWorkspace')
  const match = navItems.find((item) => pathname.startsWith(item.to))
  return match?.label ?? t('dashboardNav.dashboard')
}

// The nested route table for each role - the presentation counterpart of what
// that role can already read. A path a role is not entitled to falls through to
// the catch-all and redirects to that role's index.
//
// `flags` gates the same set of routes NAV_BY_ROLE's `flag` field gates for
// the nav - a flagged route renders the redirect-to-index fallback instead
// of its page when the company has that flag off, so a bookmarked or
// directly-typed URL can't reach what the nav already hides. This is still
// UX, not the enforcement: the callable behind each of these pages checks
// the same flag server-side (see functions/src/utils/featureFlags.js).
function DashboardRoutes({ role, companyId, departments, companyCases, flags }) {
  const { t } = useTranslation()
  const navItems = filterNavByFlags(NAV_BY_ROLE[role] ?? [], flags)
  const index = indexPathFor(navItems)
  const toIndex = <Navigate to={index} replace />
  const gated = (flag, element) => (flags[flag] === false ? toIndex : element)

  // A role whose entire nav is behind one flag (Pulse Check Reviewer,
  // Manager) has nowhere to redirect to once that flag is off - indexPathFor
  // would fall back to the bare /dashboard index route, which re-enters this
  // same component and loops. Say plainly that the feature is off instead.
  if (navItems.length === 0) {
    return (
      <Card padded={false} className="mx-auto max-w-2xl">
        <EmptyState
          title={t('dashboardNav.featureDisabled.title')}
          description={t('dashboardNav.featureDisabled.description')}
        />
      </Card>
    )
  }

  if (role === ROLES.HR_COORDINATOR) {
    return (
      <Routes>
        <Route index element={toIndex} />
        <Route path="overview" element={<HROverviewPage {...companyCases} />} />
        <Route path="cases" element={<HRCasesPage companyId={companyId} {...companyCases} />} />
        <Route path="triage" element={<HRTriagePage companyId={companyId} {...companyCases} />} />
        <Route path="patterns" element={gated('patternDetection', <PatternsPage companyId={companyId} />)} />
        <Route path="follow-ups" element={<FollowUpsPage {...companyCases} />} />
        <Route
          path="pulse-responses"
          element={gated('pulseCheck', <PulseResponsesPage companyId={companyId} />)}
        />
        <Route
          path="trends"
          element={gated('pulseCheck', <PulseTrendsPage companyId={companyId} role={role} />)}
        />
        <Route path="benchmark" element={gated('benchmarkPool', <BenchmarkPage companyId={companyId} />)} />
        <Route path="analytics" element={<AnalyticsDashboard companyId={companyId} canExport />} />
        <Route path="intake" element={<StaffIntake />} />
        <Route path="help" element={<HelpSupportPage role={role} />} />
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
        <Route path="designation" element={<DesignatedHandlersPage companyId={companyId} />} />
        <Route path="help" element={<HelpSupportPage role={role} />} />
        <Route path="*" element={toIndex} />
      </Routes>
    )
  }

  if (role === ROLES.PULSE_CHECK_REVIEWER) {
    return (
      <Routes>
        <Route index element={toIndex} />
        <Route
          path="pulse-responses"
          element={gated('pulseCheck', <PulseResponsesPage companyId={companyId} />)}
        />
        <Route
          path="trends"
          element={gated('pulseCheck', <PulseTrendsPage companyId={companyId} role={role} />)}
        />
        <Route path="help" element={<HelpSupportPage role={role} />} />
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
          element={gated(
            'pulseCheck',
            <PulseTrendsPage companyId={companyId} role={role} departments={departments} />
          )}
        />
        <Route path="help" element={<HelpSupportPage role={role} />} />
        <Route path="*" element={toIndex} />
      </Routes>
    )
  }

  return (
    <Card padded={false} className="mx-auto max-w-2xl">
      <EmptyState
        title={t('dashboardNav.nothingToShow.title')}
        description={t('dashboardNav.nothingToShow.description', {
          role: t(`roles.${role}`, { defaultValue: ROLE_LABELS[role] ?? role }),
        })}
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
  const { t } = useTranslation()
  const { user, role, customRoleId, permissions, companyId, departments } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Every hook this component ever calls, called unconditionally and above
  // any early return - including the Company Admin redirect below, which
  // renders nothing else here but must not change how many hooks this
  // component calls on the render that sets it.
  const { enabled: pulseCheckEnabled } = useFeatureFlag('pulseCheck')
  const { enabled: benchmarkPoolEnabled } = useFeatureFlag('benchmarkPool')
  const { enabled: patternDetectionEnabled } = useFeatureFlag('patternDetection')
  // One shared load of the company case metadata for the HR Coordinator's
  // pages, kept here so it survives navigation between them. Inert for every
  // other role.
  const companyCases = useCompanyCases(companyId, { enabled: role === ROLES.HR_COORDINATOR })

  // A Company Admin's entire surface is /admin; it has no /dashboard nav and no
  // /dashboard routes, so a typed or bookmarked /dashboard/* path would fall
  // through to the empty shell. Send it to /admin/overview, matching the
  // reasoning in RootRedirect, rather than giving companyAdmin a NAV_BY_ROLE
  // entry - the Company Admin surface is /admin and must stay there. A
  // custom-role holder with at least one permission has its surface at
  // /admin too - /admin's own index route resolves their landing page from
  // whatever permissions they hold. A custom-role holder with zero
  // permissions is deliberately NOT redirected here: /admin's ProtectedRoute
  // would deny them and bounce to /login, which bounces an already
  // authenticated user straight back to "/" - an infinite loop. That account
  // falls through to the "no permissions assigned" message below instead.
  if (role === ROLES.COMPANY_ADMIN) {
    return <Navigate to="/admin/overview" replace />
  }
  if (customRoleId && permissions.length > 0) {
    return <Navigate to="/admin" replace />
  }

  const flags = {
    pulseCheck: pulseCheckEnabled,
    benchmarkPool: benchmarkPoolEnabled,
    patternDetection: patternDetectionEnabled,
  }

  const navItems = filterNavByFlags(NAV_BY_ROLE[role] ?? [], flags).map((item) => ({
    ...item,
    label: t(item.labelKey),
  }))
  const roleLabel = role ? t(`roles.${role}`, { defaultValue: ROLE_LABELS[role] ?? role }) : t('roles.staff')

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  function renderBody() {
    if (!role) {
      // A customRoleId claim with an empty permissions array reaches here
      // too (see the redirect above) - that's a Company Admin configuration
      // mistake, not a broken invite, so it gets its own message rather than
      // sending the user to ask for a re-issued invite that wouldn't help.
      if (customRoleId) {
        return (
          <Alert variant="error" title={t('dashboardNav.noPermissions.title')}>
            {t('dashboardNav.noPermissions.body')}
          </Alert>
        )
      }
      return (
        <Alert variant="error" title={t('dashboardNav.noRole.title')}>
          {t('dashboardNav.noRole.body')}
        </Alert>
      )
    }
    if (!companyId) {
      return (
        <Alert variant="error" title={t('dashboardNav.notLinked.title')}>
          {t('dashboardNav.notLinked.body')}
        </Alert>
      )
    }
    return (
      <DashboardRoutes
        role={role}
        companyId={companyId}
        departments={departments}
        companyCases={companyCases}
        flags={flags}
      />
    )
  }

  return (
    <AppShell
      scopeLabel={roleLabel}
      navItems={navItems}
      userEmail={user?.email}
      roleLabel={roleLabel}
      onSignOut={handleSignOut}
      eyebrow={t('dashboardNav.eyebrow')}
      title={titleFor(location.pathname, navItems, t)}
    >
      {renderBody()}
    </AppShell>
  )
}

export default Dashboard
