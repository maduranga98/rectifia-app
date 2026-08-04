import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import AppShell from '../components/shared/AppShell'
import Alert from '../components/ui/Alert'
import OverviewPage from './company-admin/OverviewPage'
import DepartmentsPage from './company-admin/DepartmentsPage'
import StaffPage from './company-admin/StaffPage'
import RoutingRulesPage from './company-admin/RoutingRulesPage'
import BillingPage from './company-admin/BillingPage'

// Company Admin's whole surface: the shell's navigation plus the overview
// and four settings sub-pages it routes to. CompanyAdminPanel used to hold
// this routing table and render its own page title and tab strip; the shell
// owns that chrome now, so the panel had nothing left to do and its routes
// live here directly.
//
// The overview (module 15) reads only the aggregate-only
// companies/{companyId}/stats/overview rollup; departments/staff/routing/
// billing never touch cases/{caseId} or caseMetadata/{caseId} - per the
// module 2 role design, Company Admin gets case counts and settings, never
// case content, and firestore.rules doesn't grant this role a path to
// either collection even if a page here tried to read them.
//
// companyId comes from the custom claim, not a URL param or a form field: a
// Company Admin can only ever administer the company stamped on their own
// token, and firestore.rules enforces that independently.
const NAV_ITEMS = [
  { to: '/admin/overview', label: 'Overview', icon: 'overview' },
  { to: '/admin/departments', label: 'Departments', icon: 'departments' },
  { to: '/admin/staff', label: 'Staff', icon: 'staff' },
  { to: '/admin/routing', label: 'Routing rules', icon: 'routing' },
  { to: '/admin/billing', label: 'Billing', icon: 'billing' },
]

const PAGE_TITLES = {
  overview: 'Overview',
  departments: 'Departments',
  staff: 'Staff',
  routing: 'Routing rules',
  billing: 'Subscription & billing',
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
          <Route path="departments" element={<DepartmentsPage companyId={companyId} />} />
          <Route path="staff" element={<StaffPage companyId={companyId} />} />
          <Route path="routing" element={<RoutingRulesPage companyId={companyId} />} />
          <Route path="billing" element={<BillingPage companyId={companyId} />} />
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
