import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../constants/roles'
import PublicEntryPage from '../../pages/PublicEntryPage'
import { FullPageLoader } from '../ui/Loading'

// "/" is a dispatcher, not a landing page. Anyone already signed in goes
// straight to the dashboard their account is entitled to; a signed-out
// visitor gets the public entry page.
//
// That visitor used to be sent to the staff login page, which assumed every
// unauthenticated arrival was staff. A reporter who closed the tab after
// filing is unauthenticated too, and the login page gives them no route back
// to their case - PublicEntryPage does, without pretending they have an
// account. Signed-in routing is unchanged.
function RootRedirect() {
  const { user, role, customRoleId, permissions, isSuperAdmin, loading } = useAuth()

  if (loading) {
    return <FullPageLoader />
  }

  if (!user) return <PublicEntryPage />
  if (isSuperAdmin) return <Navigate to="/super-admin" replace />
  // A Company Admin's entire surface is /admin (company settings) - landing
  // them on /dashboard would only show the interstitial redirect card, so
  // send them straight to their first page rather than through it. /admin
  // itself redirects to overview anyway; naming it here skips that extra hop.
  if (role === ROLES.COMPANY_ADMIN) return <Navigate to="/admin/overview" replace />
  // A custom-role holder with at least one permission has its surface at
  // /admin too (whichever permission-gated pages their role unlocks) -
  // /admin's own index route resolves the correct landing page for them,
  // same as it does for a Company Admin. A custom-role holder with zero
  // permissions is deliberately excluded here: /admin's ProtectedRoute would
  // deny them and bounce to /login, which bounces an already authenticated
  // user straight back to "/" - an infinite loop. That account falls
  // through to /dashboard instead, which renders an explanatory message for
  // exactly this case.
  if (customRoleId && permissions.length > 0) return <Navigate to="/admin" replace />

  return <Navigate to="/dashboard" replace />
}

export default RootRedirect
