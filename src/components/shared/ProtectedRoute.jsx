import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

// Gates a route by signed-in status and, optionally, role. loginPath lets
// /super-admin send unauthorized visitors to /super-admin/login instead of
// the staff /login - the two logins are deliberately separate (see
// SuperAdminLoginPage), so this must never fall back to one shared default.
function ProtectedRoute({ children, allowedRoles, loginPath = '/login' }) {
  const { user, role, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    )
  }

  if (!user || (allowedRoles && !allowedRoles.includes(role))) {
    return <Navigate to={loginPath} state={{ from: location }} replace />
  }

  return children
}

export default ProtectedRoute
