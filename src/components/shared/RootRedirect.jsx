import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

// The app has no public landing page - "/" is just a dispatcher. A visitor
// who isn't signed in lands on the staff login page (that's what should
// come up when the app starts), and anyone already signed in goes straight
// to the dashboard their account is entitled to. Reporter-facing routes
// (/submit, /case/:caseId) are reached by link, never through here.
function RootRedirect() {
  const { user, isSuperAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return <Navigate to={isSuperAdmin ? '/super-admin' : '/dashboard'} replace />
}

export default RootRedirect
