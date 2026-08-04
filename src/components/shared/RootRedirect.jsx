import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../constants/roles'
import { FullPageLoader } from '../ui/Loading'

// The app has no public landing page - "/" is just a dispatcher. A visitor
// who isn't signed in lands on the staff login page (that's what should
// come up when the app starts), and anyone already signed in goes straight
// to the dashboard their account is entitled to. Reporter-facing routes
// (/submit, /case/:caseId) are reached by link, never through here.
function RootRedirect() {
  const { user, role, isSuperAdmin, loading } = useAuth()

  if (loading) {
    return <FullPageLoader />
  }

  if (!user) return <Navigate to="/login" replace />
  if (isSuperAdmin) return <Navigate to="/super-admin" replace />
  // A Company Admin's entire surface is /admin (company settings) - landing
  // them on /dashboard would only show the interstitial redirect card, so
  // send them straight to their first page rather than through it. /admin
  // itself redirects to overview anyway; naming it here skips that extra hop.
  if (role === ROLES.COMPANY_ADMIN) return <Navigate to="/admin/overview" replace />

  return <Navigate to="/dashboard" replace />
}

export default RootRedirect
