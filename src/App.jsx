import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/shared/ProtectedRoute'
import RootRedirect from './components/shared/RootRedirect'
import Submit from './pages/Submit'
import CaseDetail from './pages/CaseDetail'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import SuperAdminLoginPage from './pages/SuperAdminLoginPage'
import SuperAdminDashboardPage from './pages/SuperAdminDashboardPage'
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

        {/* Auth entry points. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />

        {/* Staff routes. These were previously reachable without signing in. */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
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

        {/* "/" is a dispatcher, not a landing page: signed-out visitors get
            the login page on startup, signed-in ones their dashboard. */}
        <Route path="/" element={<RootRedirect />} />
        {/* Unknown URLs resolve through the same dispatcher instead of
            rendering a blank page. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
