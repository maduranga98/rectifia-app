import { Navigate, Route, Routes } from 'react-router-dom'
import CompanySettingsTabs from './CompanySettingsTabs'
import OverviewPage from '../../pages/company-admin/OverviewPage'
import DepartmentsPage from '../../pages/company-admin/DepartmentsPage'
import StaffPage from '../../pages/company-admin/StaffPage'
import RoutingRulesPage from '../../pages/company-admin/RoutingRulesPage'
import BillingPage from '../../pages/company-admin/BillingPage'

// Company Admin shell: tabs + the overview and four settings sub-pages they
// route to. The overview (module 15) reads only the aggregate-only
// companies/{companyId}/stats/overview rollup; departments/staff/routing/
// billing still never touch cases/{caseId} or caseMetadata/{caseId} - per the
// module 2 role design, Company Admin gets case counts and settings, never
// case content, and firestore.rules doesn't grant this role a path to either
// collection even if a page here tried to read them.
function CompanyAdminPanel({ companyId }) {
  return (
    <div className="flex flex-col">
      <div className="mx-auto w-full max-w-4xl px-6 pt-6">
        <h1 className="text-xl font-semibold">Company dashboard</h1>
      </div>
      <CompanySettingsTabs />
      <Routes>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewPage companyId={companyId} />} />
        <Route path="departments" element={<DepartmentsPage companyId={companyId} />} />
        <Route path="staff" element={<StaffPage companyId={companyId} />} />
        <Route path="routing" element={<RoutingRulesPage companyId={companyId} />} />
        <Route path="billing" element={<BillingPage companyId={companyId} />} />
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Routes>
    </div>
  )
}

export default CompanyAdminPanel
