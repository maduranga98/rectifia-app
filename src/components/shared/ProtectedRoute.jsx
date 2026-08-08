import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { FullPageLoader } from '../ui/Loading'

// Gates a route by signed-in status and, optionally, a fixed staff role,
// super admin allowlist membership, or a composable permission. loginPath
// lets /super-admin send unauthorized visitors to /super-admin/login instead
// of the staff /login - the two logins are deliberately separate (see
// SuperAdminLoginPage), so this must never fall back to one shared default.
//
// `allowedRoles` stays a fixed-role array comparison deliberately for the
// callers that need one - Company Admin's own routes, and any future
// caseHandler/hrCoordinator-only route, are fixed, non-composable roles by
// design (see this module's own constraint on RoleBuilder.jsx), so a raw
// role check is the CORRECT gate for them, not a hardcoded shortcut to clean
// up. `requiredPermission` is the new, second gate for a route a composable
// custom role should be able to reach: it resolves through
// AuthContext.hasPermission, which mirrors permissionResolver.js's algorithm
// (src/utils/permissions.js) rather than comparing a role string, so a new
// permission-gated route never needs its own bespoke role list. The two
// props are independent grants (either satisfies the route, not both
// required) so a route can be opened to "Company Admin OR anyone holding
// permission X" with one ProtectedRoute.
function ProtectedRoute({
  children,
  allowedRoles,
  requiredPermission,
  requireSuperAdmin = false,
  loginPath = '/login',
}) {
  const { user, role, isSuperAdmin, hasPermission, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    // Super Admin routes resolve onto a dark surface, so the loader matches
    // the page that's about to render rather than flashing a light screen.
    return <FullPageLoader onDark={requireSuperAdmin} />
  }

  const roleGrant = allowedRoles ? allowedRoles.includes(role) : false
  const requiredPermissionKeys = Array.isArray(requiredPermission)
    ? requiredPermission
    : requiredPermission
      ? [requiredPermission]
      : []
  const permissionGrant = requiredPermissionKeys.some((key) => hasPermission(key))
  // When neither prop is given, the route only requires sign-in (and super
  // admin membership, if requireSuperAdmin) - preserved exactly as before
  // this module.
  const roleOrPermissionSatisfied = !allowedRoles && !requiredPermission ? true : roleGrant || permissionGrant

  const isAuthorized = user && (requireSuperAdmin ? isSuperAdmin : true) && roleOrPermissionSatisfied

  if (!isAuthorized) {
    return <Navigate to={loginPath} state={{ from: location }} replace />
  }

  return children
}

export default ProtectedRoute
