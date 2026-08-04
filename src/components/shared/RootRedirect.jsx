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
  const { user, role, isSuperAdmin, loading } = useAuth()

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

  return <Navigate to="/dashboard" replace />
}

export default RootRedirect
