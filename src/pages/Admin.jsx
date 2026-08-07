import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import { ROLES } from '../constants/roles'
import AppShell from '../components/shared/AppShell'
import Alert from '../components/ui/Alert'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import OverviewPage from './company-admin/OverviewPage'
import CasesPage from './company-admin/CasesPage'
import DepartmentsPage from './company-admin/DepartmentsPage'
import PoliciesPage from './company-admin/PoliciesPage'
import StaffPage from './company-admin/StaffPage'
import RoleBuilder from '../components/dashboard/RoleBuilder'
import EmployeesPage from './company-admin/EmployeesPage'
import PulseQuestionsPage from './company-admin/PulseQuestionsPage'
import RoutingRulesPage from './company-admin/RoutingRulesPage'
import BillingPage from './company-admin/BillingPage'
import SettingsPage from './company-admin/SettingsPage'
import RetentionPage from './company-admin/RetentionPage'
import BenchmarkPage from './company-admin/BenchmarkPage'
import AnalyticsDashboard from '../components/dashboard/AnalyticsDashboard'
import PulseTrendsPage from './staff/PulseTrendsPage'

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
// Entries with a `flag` are hidden - and their route redirected - when that
// per-company feature flag (src/config/featureFlags.js) is off. See
// Dashboard.jsx's identical convention for the staff nav; this is the
// Company Admin counterpart.
// `permission` names the composable permission key (src/config/permissionModules.js)
// that opens this item to a custom-role holder - see filterNavByAccess below.
// An item with no `permission` is Company Admin-only: a fixed role never
// carries composable keys, so there is no key that could ever open it to a
// custom role, by design (RoleBuilder.jsx's allowlist and this list must
// agree on that).
const NAV_ITEMS = [
  { to: '/admin/overview', label: 'Overview', icon: 'overview' },
  { to: '/admin/cases', label: 'Cases', icon: 'cases' },
  { to: '/admin/analytics', label: 'Analytics', icon: 'sparkle' },
  { to: '/admin/departments', label: 'Departments', icon: 'departments', permission: 'departments' },
  { to: '/admin/policies', label: 'Policies', icon: 'document', permission: 'policyManagement' },
  { to: '/admin/staff', label: 'Staff', icon: 'staff', permission: 'staffManagement' },
  { to: '/admin/roles', label: 'Custom roles', icon: 'staff' },
  { to: '/admin/employees', label: 'Employees', icon: 'pulse', flag: 'pulseCheck' },
  { to: '/admin/routing', label: 'Routing rules', icon: 'routing', permission: 'routingRules' },
  { to: '/admin/billing', label: 'Billing', icon: 'billing', permission: 'billingView' },
  // Sits next to Settings deliberately: pulseCheckCadence (how often check-ins
  // go out) lives there, and this is what those check-ins ask.
  { to: '/admin/pulse-questions', label: 'Pulse questions', icon: 'pulse', flag: 'pulseCheck' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings', permission: 'complianceConfig' },
  { to: '/admin/retention', label: 'Data retention', icon: 'clock', permission: 'retentionSettings' },
  // Module 25's opt-in control. Deliberately at the end of the nav rather
  // than under Settings: opting in publishes an aggregate representation of
  // this company's closed cases to every other opted-in reader, which is
  // consequential enough to be its own decision rather than a checkbox on a
  // settings screen.
  { to: '/admin/benchmark', label: 'Benchmark pool', icon: 'overview', flag: 'benchmarkPool' },
  // The one permission whose page otherwise lives under /dashboard (the
  // Manager's "Team wellness"); pulseAggregateView opens this /admin
  // counterpart, which renders the same component.
  {
    to: '/admin/wellness',
    label: 'Team wellness',
    icon: 'pulse',
    flag: 'pulseCheck',
    permission: 'pulseAggregateView',
  },
]

function filterNavByFlags(navItems, flags) {
  return navItems.filter((item) => !item.flag || flags[item.flag] !== false)
}

// A Company Admin sees every item regardless of `permission` - fixed roles
// never carry composable keys, so gating them through hasPermission() would
// filter their nav down to nothing. A custom-role holder sees only items
// whose permission key they hold; an item with no `permission` field is
// Company Admin-only and never shows up for them.
function filterNavByAccess(navItems, { isCompanyAdmin, hasPermission }) {
  if (isCompanyAdmin) return navItems
  return navItems.filter((item) => item.permission && hasPermission(item.permission))
}

const PAGE_TITLES = {
  overview: 'Overview',
  cases: 'Cases',
  analytics: 'Analytics & reporting',
  departments: 'Departments',
  policies: 'Policies',
  staff: 'Staff',
  roles: 'Custom roles',
  employees: 'Employees',
  'pulse-questions': 'Pulse check questions',
  routing: 'Routing rules',
  billing: 'Subscription & billing',
  settings: 'Company settings',
  retention: 'Data retention & deletion',
  benchmark: 'Cross-company benchmark pool',
  wellness: 'Team wellness',
}

// The first /admin page an account is entitled to - where the index route
// and any unentitled path both land. Mirrors indexPathFor in Dashboard.jsx:
// a Company Admin's first item is always 'overview', a custom-role holder's
// is whichever of their permission-gated items sorts first in NAV_ITEMS.
function indexPathFor(navItems) {
  return navItems.find((item) => item.to.startsWith('/admin/'))?.to ?? '/admin'
}

function Admin() {
  const { user, companyId, role, customRoleName, hasPermission } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isCompanyAdmin = role === ROLES.COMPANY_ADMIN

  const { enabled: pulseCheckEnabled } = useFeatureFlag('pulseCheck')
  const { enabled: benchmarkPoolEnabled } = useFeatureFlag('benchmarkPool')
  const flags = { pulseCheck: pulseCheckEnabled, benchmarkPool: benchmarkPoolEnabled }
  const navItems = filterNavByAccess(filterNavByFlags(NAV_ITEMS, flags), { isCompanyAdmin, hasPermission })
  const toIndex = <Navigate to={indexPathFor(navItems)} replace />

  // Gates one <Route>'s element the same way its NAV_ITEMS entry is gated
  // from the nav: a flag that's off, or - for anyone but a Company Admin - a
  // permission the account doesn't hold, falls through to that account's own
  // index rather than rendering. A route with no `permission` option is
  // Company Admin-only, matching its NAV_ITEMS entry having no `permission`
  // field.
  const gated = (element, { flag, permission } = {}) => {
    if (flag && flags[flag] === false) return toIndex
    if (isCompanyAdmin) return element
    return permission && hasPermission(permission) ? element : toIndex
  }

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  const section = location.pathname.split('/')[2] ?? 'overview'
  const roleLabel = customRoleName ?? 'Company Admin'
  const scopeLabel = isCompanyAdmin ? 'Company administration' : customRoleName ?? 'Staff'

  return (
    <AppShell
      scopeLabel={scopeLabel}
      navItems={navItems}
      userEmail={user?.email}
      roleLabel={roleLabel}
      onSignOut={handleSignOut}
      eyebrow="Company dashboard"
      title={PAGE_TITLES[section] ?? 'Overview'}
    >
      {companyId ? navItems.length === 0 ? (
        // A custom-role holder whose only permission's page sits behind a
        // feature flag that's currently off (e.g. pulseAggregateView with
        // pulseCheck disabled) has nowhere to land - indexPathFor would fall
        // back to the bare /admin index route, which re-enters this same
        // component and loops. Say plainly that the feature is off instead,
        // same as Dashboard.jsx's identical edge case.
        <Card padded={false} className="mx-auto max-w-2xl">
          <EmptyState
            title="This feature is currently disabled"
            description="Ask a Super Admin to enable it for your company."
          />
        </Card>
      ) : (
        <Routes>
          <Route index element={toIndex} />
          <Route path="overview" element={gated(<OverviewPage companyId={companyId} />)} />
          <Route path="cases" element={gated(<CasesPage companyId={companyId} />)} />
          <Route
            path="analytics"
            element={gated(<AnalyticsDashboard companyId={companyId} canExport />)}
          />
          <Route
            path="departments"
            element={gated(<DepartmentsPage companyId={companyId} />, { permission: 'departments' })}
          />
          <Route
            path="policies"
            element={gated(<PoliciesPage companyId={companyId} />, { permission: 'policyManagement' })}
          />
          <Route
            path="staff"
            element={gated(<StaffPage companyId={companyId} />, { permission: 'staffManagement' })}
          />
          <Route path="roles" element={gated(<RoleBuilder companyId={companyId} />)} />
          <Route
            path="employees"
            element={gated(<EmployeesPage companyId={companyId} />, { flag: 'pulseCheck' })}
          />
          <Route
            path="pulse-questions"
            element={gated(<PulseQuestionsPage companyId={companyId} />, { flag: 'pulseCheck' })}
          />
          <Route
            path="routing"
            element={gated(<RoutingRulesPage companyId={companyId} />, { permission: 'routingRules' })}
          />
          <Route
            path="billing"
            element={gated(<BillingPage companyId={companyId} />, { permission: 'billingView' })}
          />
          <Route
            path="settings"
            element={gated(<SettingsPage companyId={companyId} />, { permission: 'complianceConfig' })}
          />
          <Route
            path="retention"
            element={gated(<RetentionPage companyId={companyId} />, { permission: 'retentionSettings' })}
          />
          <Route
            path="benchmark"
            element={gated(<BenchmarkPage companyId={companyId} />, { flag: 'benchmarkPool' })}
          />
          <Route
            path="wellness"
            element={gated(<PulseTrendsPage companyId={companyId} />, {
              flag: 'pulseCheck',
              permission: 'pulseAggregateView',
            })}
          />
          <Route path="*" element={toIndex} />
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
