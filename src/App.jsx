import { Navigate, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/shared/ProtectedRoute'
import RootRedirect from './components/shared/RootRedirect'
import Submit from './pages/Submit'
import CaseDetail from './pages/CaseDetail'
import PulseCheck from './pages/PulseCheck'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import SuperAdminLoginPage from './pages/SuperAdminLoginPage'
import SuperAdminDashboardPage from './pages/SuperAdminDashboardPage'
import SecurityDashboard from './pages/superadmin/SecurityDashboard'
import { ROLES } from './constants/roles'

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Anonymous reporter routes - deliberately not behind auth. The
            reporting entry point is company-scoped: the slug in the path is
            resolved to a company server-side, so a report can only be filed
            against a real company's queue. A bare /submit with no company is
            not a valid reporting link and resolves through the dispatcher. */}
        <Route path="/submit/:companySlug" element={<Submit />} />
        {/* Both forms of the tracking route: with a Case ID when the
            reporter followed a link, without one when they arrived cold and
            type it in. */}
        <Route path="/case" element={<CaseDetail />} />
        <Route path="/case/:caseId" element={<CaseDetail />} />
        {/* Roster employees have no account: a pulse-check invite is reached by
            its single-use token (/pulse/:inviteId?t=<token>), so this route is
            deliberately outside ProtectedRoute, same as the reporter routes. */}
        <Route path="/pulse/:inviteId" element={<PulseCheck />} />

        {/* Auth entry points. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />

        {/* Staff routes. These were previously reachable without signing in. */}
        <Route
          path="/dashboard/*"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        {/* Staff-initiated intake now lives inside the dashboard shell at
            /dashboard/intake, so it shares the staff nav instead of swapping in
            a two-item nav of its own. This top-level /intake is kept only as a
            redirect so existing bookmarks and any older call site still
            resolve; the role gate and the createCaseOnBehalf refusal both live
            on the dashboard side. */}
        <Route path="/intake" element={<Navigate to="/dashboard/intake" replace />} />
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute allowedRoles={[ROLES.COMPANY_ADMIN]}>
              <Admin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/super-admin"
          element={
            <ProtectedRoute requireSuperAdmin loginPath="/super-admin/login">
              <SuperAdminDashboardPage />
            </ProtectedRoute>
          }
        />
        {/* Module 26: Security Control & Evidence Layer. Same guard as
            /super-admin above - Super Admin allowlist membership, not a
            custom claim. */}
        <Route
          path="/super-admin/security"
          element={
            <ProtectedRoute requireSuperAdmin loginPath="/super-admin/login">
              <SecurityDashboard />
            </ProtectedRoute>
          }
        />

        {/* "/" is a dispatcher, not a landing page: signed-out visitors get
            the public entry page (track a case, or staff sign-in), signed-in
            ones their dashboard. */}
        <Route path="/" element={<RootRedirect />} />
        {/* Unknown URLs resolve through the same dispatcher rather than
            rendering a blank page - a reporter who mistypes or follows a
            stale link still gets a route back into their case, which
            bouncing them to the staff login page never gave them. */}
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
