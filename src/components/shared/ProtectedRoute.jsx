import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

// Gates a route by signed-in status and, optionally, staff role or super
// admin allowlist membership. loginPath lets /super-admin send unauthorized
// visitors to /super-admin/login instead of the staff /login - the two
// logins are deliberately separate (see SuperAdminLoginPage), so this must
// never fall back to one shared default.
function ProtectedRoute({ children, allowedRoles, requireSuperAdmin = false, loginPath = '/login' }) {
  const { user, role, isSuperAdmin, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    )
  }

  const isAuthorized =
    user &&
    (requireSuperAdmin ? isSuperAdmin : true) &&
    (allowedRoles ? allowedRoles.includes(role) : true)

  if (!isAuthorized) {
    return <Navigate to={loginPath} state={{ from: location }} replace />
  }

  return children
}

export default ProtectedRoute
