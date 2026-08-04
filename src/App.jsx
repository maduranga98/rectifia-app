import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/shared/ProtectedRoute'
import Home from './pages/Home'
import Submit from './pages/Submit'
import CaseDetail from './pages/CaseDetail'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import SuperAdminLoginPage from './pages/SuperAdminLoginPage'
import SuperAdminDashboardPage from './pages/SuperAdminDashboardPage'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/case/:caseId" element={<CaseDetail />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route path="/super-admin/login" element={<SuperAdminLoginPage />} />
        <Route
          path="/super-admin"
          element={
            <ProtectedRoute requireSuperAdmin loginPath="/super-admin/login">
              <SuperAdminDashboardPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

export default App
