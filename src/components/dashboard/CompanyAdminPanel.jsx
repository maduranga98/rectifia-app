import { Navigate, Route, Routes } from 'react-router-dom'
import CompanySettingsTabs from './CompanySettingsTabs'
import DepartmentsPage from '../../pages/company-admin/DepartmentsPage'
import StaffPage from '../../pages/company-admin/StaffPage'
import RoutingRulesPage from '../../pages/company-admin/RoutingRulesPage'
import BillingPage from '../../pages/company-admin/BillingPage'

// Company Admin settings shell: tabs + the four sub-pages they route to
// (departments, staff, routing rules, and a read-only subscription/billing
// view). Deliberately never touches cases/{caseId} or caseMetadata/{caseId}
// - per the module 2 role design, Company Admin gets structure and settings
// only, never case content. Nothing here or in the pages it renders reads a
// case, and firestore.rules doesn't grant this role a path to either
// collection even if there were.
function CompanyAdminPanel({ companyId }) {
  return (
    <div className="flex flex-col">
      <div className="mx-auto w-full max-w-4xl px-6 pt-6">
        <h1 className="text-xl font-semibold">Company settings</h1>
      </div>
      <CompanySettingsTabs />
      <Routes>
        <Route index element={<Navigate to="departments" replace />} />
        <Route path="departments" element={<DepartmentsPage companyId={companyId} />} />
        <Route path="staff" element={<StaffPage companyId={companyId} />} />
        <Route path="routing" element={<RoutingRulesPage companyId={companyId} />} />
        <Route path="billing" element={<BillingPage companyId={companyId} />} />
        <Route path="*" element={<Navigate to="departments" replace />} />
      </Routes>
    </div>
  )
}

export default CompanyAdminPanel
