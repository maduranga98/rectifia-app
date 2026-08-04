import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { FullPageLoader } from '../ui/Loading'

// Gates a route by signed-in status and, optionally, staff role or super
// admin allowlist membership. loginPath lets /super-admin send unauthorized
// visitors to /super-admin/login instead of the staff /login - the two
// logins are deliberately separate (see SuperAdminLoginPage), so this must
// never fall back to one shared default.
function ProtectedRoute({ children, allowedRoles, requireSuperAdmin = false, loginPath = '/login' }) {
  const { user, role, isSuperAdmin, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    // Super Admin routes resolve onto a dark surface, so the loader matches
    // the page that's about to render rather than flashing a light screen.
    return <FullPageLoader onDark={requireSuperAdmin} />
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
