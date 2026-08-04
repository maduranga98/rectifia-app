import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { signIn, signOutUser, checkSuperAdmin } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'

// Platform-level login, deliberately separate from the staff LoginPage:
// different route, different heading, dark theme so it never gets mistaken
// for a company-scoped sign-in. Same Firebase Auth mechanism underneath,
// but only accounts listed in the superAdmins Firestore collection (doc id
// = uid, see authService.checkSuperAdmin) may proceed past this page -
// anyone else gets an access-denied message here, never a redirect into a
// company dashboard.
function SuperAdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const { user: currentUser, isSuperAdmin: currentIsSuperAdmin, loading } = useAuth()

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const user = await signIn(email, password)
      const isSuperAdmin = await checkSuperAdmin(user.uid)
      if (!isSuperAdmin) {
        await signOutUser()
        setError('Access denied. This sign-in is for Lumora platform administrators only.')
        return
      }
      navigate('/super-admin', { replace: true })
    } catch (err) {
      // Only genuine Firebase Auth rejections mean bad credentials - a
      // failed allowlist lookup used to be reported as a wrong password.
      setError(
        err?.code?.startsWith('auth/')
          ? 'Incorrect email or password'
          : 'Could not sign in right now. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  // An already signed-in super admin has no reason to see this form again.
  if (!loading && currentUser && currentIsSuperAdmin) {
    return <Navigate to="/super-admin" replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-900 p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <h1 className="text-xl font-semibold text-white">Lumora Platform Admin</h1>
        <p className="text-sm text-navy-200">Super Admin access only - not scoped to any company.</p>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-lg border border-navy-600 bg-navy p-5 shadow-lg"
        >
          <input
            type="email"
            required
            placeholder="admin@lumora.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white placeholder:text-navy-200"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-navy-600 bg-navy-900 px-3 py-2 text-sm text-white placeholder:text-navy-200"
          />

          {error && <p className="text-sm text-critical-200">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="btn-accent rounded px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default SuperAdminLoginPage
