import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import AppShell from '../components/shared/AppShell'
import Alert from '../components/ui/Alert'
import OverviewPage from './company-admin/OverviewPage'
import CasesPage from './company-admin/CasesPage'
import DepartmentsPage from './company-admin/DepartmentsPage'
import PoliciesPage from './company-admin/PoliciesPage'
import StaffPage from './company-admin/StaffPage'
import EmployeesPage from './company-admin/EmployeesPage'
import PulseQuestionsPage from './company-admin/PulseQuestionsPage'
import RoutingRulesPage from './company-admin/RoutingRulesPage'
import BillingPage from './company-admin/BillingPage'
import SettingsPage from './company-admin/SettingsPage'
import RetentionPage from './company-admin/RetentionPage'
import BenchmarkPage from './company-admin/BenchmarkPage'
import AnalyticsDashboard from '../components/dashboard/AnalyticsDashboard'

// Company Admin's whole surface: the shell's navigation plus the overview
// and four settings sub-pages it routes to. CompanyAdminPanel used to hold
// this routing table and render its own page title and tab strip; the shell
// owns that chrome now, so the panel had nothing left to do and its routes
// live here directly.
//
// The overview (module 15) reads only the aggregate-only
// companies/{companyId}/stats/overview rollup; departments/staff/routing/
// billing never touch cases/{caseId} or caseMetadata/{caseId}.
//
// Cases is the one exception, and a deliberately narrow one: it reads
// caseMetadata for cases stalled on 'no_routing_rule' (the only rows
// firestore.rules lets this role read) and opens case content solely through
// the getCaseForTriage callable's server-side allowlist, so the admin can
// read a waiting report and place it. This is the same view-and-assign flow
// RoutingRulesPage already carried in its "Needs attention" card - Cases just
// gives it a home of its own instead of burying it under routing setup. No
// broader path to cases/ or caseMetadata/ is granted.
//
// Analytics (module 28) is the second case-derived read, and stays inside
// the same boundary: it reads companies/{companyId}/analytics/*, a daily
// recompute from caseMetadata and referenceCases with every breakdown
// already k-anonymity-floored before it is written, never cases/{caseId} or
// caseMetadata directly. Still no broader path is granted.
//
// companyId comes from the custom claim, not a URL param or a form field: a
// Company Admin can only ever administer the company stamped on their own
// token, and firestore.rules enforces that independently.
const NAV_ITEMS = [
  { to: '/admin/overview', label: 'Overview', icon: 'overview' },
  { to: '/admin/cases', label: 'Cases', icon: 'cases' },
  { to: '/admin/analytics', label: 'Analytics', icon: 'sparkle' },
  { to: '/admin/departments', label: 'Departments', icon: 'departments' },
  { to: '/admin/policies', label: 'Policies', icon: 'document' },
  { to: '/admin/staff', label: 'Staff', icon: 'staff' },
  { to: '/admin/employees', label: 'Employees', icon: 'pulse' },
  { to: '/admin/routing', label: 'Routing rules', icon: 'routing' },
  { to: '/admin/billing', label: 'Billing', icon: 'billing' },
  // Sits next to Settings deliberately: pulseCheckCadence (how often check-ins
  // go out) lives there, and this is what those check-ins ask.
  { to: '/admin/pulse-questions', label: 'Pulse questions', icon: 'pulse' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
  { to: '/admin/retention', label: 'Data retention', icon: 'clock' },
  // Module 25's opt-in control. Deliberately at the end of the nav rather
  // than under Settings: opting in publishes an aggregate representation of
  // this company's closed cases to every other opted-in reader, which is
  // consequential enough to be its own decision rather than a checkbox on a
  // settings screen.
  { to: '/admin/benchmark', label: 'Benchmark pool', icon: 'overview' },
]

const PAGE_TITLES = {
  overview: 'Overview',
  cases: 'Cases',
  analytics: 'Analytics & reporting',
  departments: 'Departments',
  policies: 'Policies',
  staff: 'Staff',
  employees: 'Employees',
  'pulse-questions': 'Pulse check questions',
  routing: 'Routing rules',
  billing: 'Subscription & billing',
  settings: 'Company settings',
  retention: 'Data retention & deletion',
  benchmark: 'Cross-company benchmark pool',
}

function Admin() {
  const { user, companyId } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  const section = location.pathname.split('/')[2] ?? 'overview'

  return (
    <AppShell
      scopeLabel="Company administration"
      navItems={NAV_ITEMS}
      userEmail={user?.email}
      roleLabel="Company Admin"
      onSignOut={handleSignOut}
      eyebrow="Company dashboard"
      title={PAGE_TITLES[section] ?? 'Overview'}
    >
      {companyId ? (
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage companyId={companyId} />} />
          <Route path="cases" element={<CasesPage companyId={companyId} />} />
          <Route path="analytics" element={<AnalyticsDashboard companyId={companyId} canExport />} />
          <Route path="departments" element={<DepartmentsPage companyId={companyId} />} />
          <Route path="policies" element={<PoliciesPage companyId={companyId} />} />
          <Route path="staff" element={<StaffPage companyId={companyId} />} />
          <Route path="employees" element={<EmployeesPage companyId={companyId} />} />
          <Route
            path="pulse-questions"
            element={<PulseQuestionsPage companyId={companyId} />}
          />
          <Route path="routing" element={<RoutingRulesPage companyId={companyId} />} />
          <Route path="billing" element={<BillingPage companyId={companyId} />} />
          <Route path="settings" element={<SettingsPage companyId={companyId} />} />
          <Route path="retention" element={<RetentionPage companyId={companyId} />} />
          <Route path="benchmark" element={<BenchmarkPage companyId={companyId} />} />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Routes>
      ) : (
        // No companyId claim means the account was never linked to a company
        // - an empty panel would look like the company had no data, so say
        // what is actually wrong.
        <Alert variant="error" title="Account not linked to a company">
          This account ({user?.email}) is not linked to a company, so there is nothing to
          administer. Ask Lumora to re-issue the account.
        </Alert>
      )}
    </AppShell>
  )
}

export default Admin
