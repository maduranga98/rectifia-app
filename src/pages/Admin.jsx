import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { useFeatureFlag } from '../hooks/useFeatureFlag'
import { useCompanyBlocked } from '../hooks/useCompanyBlocked'
import { ROLES } from '../constants/roles'
import AppShell from '../components/shared/AppShell'
import AccessBlockedNotice from '../components/shared/AccessBlockedNotice'
import Alert from '../components/ui/Alert'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'
import OverviewPage from './company-admin/OverviewPage'
import CasesPage from './company-admin/CasesPage'
import DepartmentsPage from './company-admin/DepartmentsPage'
import PoliciesPage from './company-admin/PoliciesPage'
import StaffPage from './company-admin/StaffPage'
import EmployeesPage from './company-admin/EmployeesPage'
import PulseQuestionsPage from './company-admin/PulseQuestionsPage'
import RoutingRulesPage from './company-admin/RoutingRulesPage'
import DesignatedHandlersPage from './company-admin/DesignatedHandlersPage'
import BillingPage from './company-admin/BillingPage'
import SettingsPage from './company-admin/SettingsPage'
import RetentionPage from './company-admin/RetentionPage'
import BenchmarkPage from './company-admin/BenchmarkPage'
import AnalyticsDashboard from '../components/dashboard/AnalyticsDashboard'
import PulseTrendsPage from './staff/PulseTrendsPage'
import HelpSupportPage from './shared/HelpSupportPage'

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
// `section` groups the rendered nav (AppShell's NavItems) without changing
// what filterNavByFlags/filterNavByAccess operate over - both still run on
// the flat array below, so a route being gated in or out never has to know
// about grouping.
// `labelKey`/`sectionKey` are adminNav.* translation keys, resolved with
// `t()` when navItems is built in Admin() below - see Dashboard.jsx's
// identical convention for NAV_BY_ROLE.
const NAV_ITEMS = [
  { to: '/admin/overview', labelKey: 'adminNav.overview', icon: 'overview', sectionKey: 'adminNav.sections.cases' },
  { to: '/admin/cases', labelKey: 'adminNav.cases', icon: 'cases', sectionKey: 'adminNav.sections.cases' },
  { to: '/admin/analytics', labelKey: 'adminNav.analytics', icon: 'sparkle', sectionKey: 'adminNav.sections.cases' },
  {
    to: '/admin/departments',
    labelKey: 'adminNav.departments',
    icon: 'departments',
    permission: 'departments',
    sectionKey: 'adminNav.sections.organization',
  },
  {
    to: '/admin/staff',
    labelKey: 'adminNav.staff',
    icon: 'staff',
    permission: 'staffManagement',
    sectionKey: 'adminNav.sections.organization',
  },
  {
    to: '/admin/employees',
    labelKey: 'adminNav.employees',
    icon: 'pulse',
    sectionKey: 'adminNav.sections.organization',
  },
  {
    to: '/admin/routing',
    labelKey: 'adminNav.routingRules',
    icon: 'routing',
    permission: 'routingRules',
    sectionKey: 'adminNav.sections.organization',
  },
  {
    to: '/admin/policies',
    labelKey: 'adminNav.policies',
    icon: 'document',
    permission: 'policyManagement',
    sectionKey: 'adminNav.sections.policyCompliance',
  },
  // JP's designated-handler (従事者) register - see DesignatedHandlersPage.jsx.
  // No `flag` gate: the register stays reachable even for a company without
  // JP configured (the page itself explains it's optional in that case), so
  // a company can designate handlers ahead of adding the jurisdiction.
  {
    to: '/admin/designated-handlers',
    labelKey: 'adminNav.designatedHandlers',
    icon: 'shield',
    permission: 'designatedHandlers',
    sectionKey: 'adminNav.sections.policyCompliance',
  },
  // Sits next to Settings deliberately: pulseCheckCadence (how often check-ins
  // go out) lives there, and this is what those check-ins ask.
  {
    to: '/admin/pulse-questions',
    labelKey: 'adminNav.pulseQuestions',
    icon: 'pulse',
    flag: 'pulseCheck',
    sectionKey: 'adminNav.sections.policyCompliance',
  },
  {
    to: '/admin/retention',
    labelKey: 'adminNav.dataRetention',
    icon: 'clock',
    permission: 'retentionSettings',
    sectionKey: 'adminNav.sections.policyCompliance',
  },
  // Module 25's opt-in control. Deliberately not under Settings: opting in
  // publishes an aggregate representation of this company's closed cases to
  // every other opted-in reader, which is consequential enough to be its own
  // decision rather than a checkbox on a settings screen.
  {
    to: '/admin/benchmark',
    labelKey: 'adminNav.benchmarkPool',
    icon: 'overview',
    flag: 'benchmarkPool',
    sectionKey: 'adminNav.sections.policyCompliance',
  },
  {
    to: '/admin/billing',
    labelKey: 'adminNav.billing',
    icon: 'billing',
    permission: 'billingView',
    sectionKey: 'adminNav.sections.account',
  },
  {
    to: '/admin/settings',
    labelKey: 'adminNav.settings',
    icon: 'settings',
    permission: 'complianceConfig',
    sectionKey: 'adminNav.sections.account',
  },
  // The one permission whose page otherwise lives under /dashboard (the
  // Manager's "Team wellness"); pulseAggregateView opens this /admin
  // counterpart, which renders the same component. No section of its own -
  // it rides along wherever it's granted, same as before grouping existed.
  {
    to: '/admin/wellness',
    labelKey: 'adminNav.teamWellness',
    icon: 'pulse',
    flag: 'pulseCheck',
    permission: 'pulseAggregateView',
    sectionKey: 'adminNav.sections.account',
  },
  // Company Admin only, same as every other unpermissioned item above - a
  // custom-role holder's Help & Support needs are covered by whichever
  // permissioned pages they hold, not by a page of its own.
  { to: '/admin/help', labelKey: 'adminNav.help', icon: 'help', sectionKey: 'adminNav.sections.account' },
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

const PAGE_TITLE_KEYS = {
  overview: 'adminNav.pageTitles.overview',
  cases: 'adminNav.pageTitles.cases',
  analytics: 'adminNav.pageTitles.analytics',
  departments: 'adminNav.pageTitles.departments',
  policies: 'adminNav.pageTitles.policies',
  'designated-handlers': 'adminNav.pageTitles.designatedHandlers',
  staff: 'adminNav.pageTitles.staff',
  roles: 'adminNav.pageTitles.staff',
  employees: 'adminNav.pageTitles.employees',
  'pulse-questions': 'adminNav.pageTitles.pulseQuestions',
  routing: 'adminNav.pageTitles.routing',
  billing: 'adminNav.pageTitles.billing',
  settings: 'adminNav.pageTitles.settings',
  retention: 'adminNav.pageTitles.retention',
  benchmark: 'adminNav.pageTitles.benchmark',
  wellness: 'adminNav.pageTitles.wellness',
  help: 'adminNav.pageTitles.help',
}

// The first /admin page an account is entitled to - where the index route
// and any unentitled path both land. Mirrors indexPathFor in Dashboard.jsx:
// a Company Admin's first item is always 'overview', a custom-role holder's
// is whichever of their permission-gated items sorts first in NAV_ITEMS.
function indexPathFor(navItems) {
  return navItems.find((item) => item.to.startsWith('/admin/'))?.to ?? '/admin'
}

function Admin() {
  const { t } = useTranslation()
  const { user, companyId, role, customRoleName, hasPermission } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isCompanyAdmin = role === ROLES.COMPANY_ADMIN

  const { blocked: companyBlocked } = useCompanyBlocked()
  const { enabled: pulseCheckEnabled } = useFeatureFlag('pulseCheck')
  const { enabled: benchmarkPoolEnabled } = useFeatureFlag('benchmarkPool')
  const flags = { pulseCheck: pulseCheckEnabled, benchmarkPool: benchmarkPoolEnabled }
  const navItems = filterNavByAccess(filterNavByFlags(NAV_ITEMS, flags), { isCompanyAdmin, hasPermission }).map(
    (item) => ({ ...item, label: t(item.labelKey), section: t(item.sectionKey) })
  )
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
  const roleLabel = customRoleName ?? t('roles.companyAdmin')
  const scopeLabel = isCompanyAdmin
    ? t('adminNav.companyAdministration')
    : (customRoleName ?? t('roles.staff'))

  return (
    <AppShell
      scopeLabel={scopeLabel}
      navItems={navItems}
      userEmail={user?.email}
      roleLabel={roleLabel}
      onSignOut={handleSignOut}
      eyebrow={t('adminNav.eyebrow')}
      title={t(PAGE_TITLE_KEYS[section] ?? 'adminNav.pageTitles.overview')}
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
            title={t('dashboardNav.featureDisabled.title')}
            description={t('dashboardNav.featureDisabled.description')}
          />
        </Card>
      ) : (
        <>
          {companyBlocked && section !== 'billing' && <AccessBlockedNotice />}
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
            path="designated-handlers"
            element={gated(<DesignatedHandlersPage companyId={companyId} />, {
              permission: 'designatedHandlers',
            })}
          />
          <Route
            path="staff"
            element={gated(<StaffPage companyId={companyId} />, { permission: 'staffManagement' })}
          />
          {/* Custom roles moved into StaffPage as a tab. No `permission`
              option here, same as this route carried before the move - it
              was Company Admin-only then (RoleBuilder had no permission gate
              of its own) and stays Company Admin-only now, matching the tab
              itself being hidden from every staffManagement custom-role
              holder (see StaffPage's own comment on why). The route stays
              live and lands on that tab so existing bookmarks and deep links
              to /admin/roles keep working for the accounts that could always
              reach it. */}
          <Route path="roles" element={gated(<StaffPage companyId={companyId} initialTab="roles" />)} />
          <Route
            path="employees"
            element={gated(<EmployeesPage companyId={companyId} />)}
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
          <Route path="help" element={gated(<HelpSupportPage role={ROLES.COMPANY_ADMIN} />)} />
          <Route path="*" element={toIndex} />
          </Routes>
        </>
      ) : (
        // No companyId claim means the account was never linked to a company
        // - an empty panel would look like the company had no data, so say
        // what is actually wrong.
        <Alert variant="error" title={t('dashboardNav.notLinked.title')}>
          {t('adminNav.notLinkedBody', { email: user?.email })}
        </Alert>
      )}
    </AppShell>
  )
}

export default Admin
