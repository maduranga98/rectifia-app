import { useState } from 'react'
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { signIn, checkSuperAdmin } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'

// Staff sign-in only. There is no self-signup link here on purpose - the
// only ways to get a staff account are an invite (AcceptInvitePage) or one
// created directly by Lumora. Reporter Case-ID access (module 4) is a
// separate flow entirely and is never reachable from this page.
function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { user: currentUser, isSuperAdmin: currentIsSuperAdmin, loading } = useAuth()

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const user = await signIn(email, password)
      const isSuperAdmin = await checkSuperAdmin(user.uid)
      const fallback = isSuperAdmin ? '/super-admin' : '/dashboard'
      // Return the user to whatever ProtectedRoute bounced them off of.
      navigate(location.state?.from?.pathname ?? fallback, { replace: true })
    } catch (err) {
      setError(
        err?.code?.startsWith('auth/')
          ? 'Incorrect email or password'
          : 'Could not sign in right now. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  // Already signed in - don't show the form again, go where they belong.
  if (!loading && currentUser) {
    return <Navigate to={currentIsSuperAdmin ? '/super-admin' : '/dashboard'} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight text-navy">Rectifia</span>
        </div>
        <h1 className="text-xl font-semibold">Staff sign in</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <input
            type="email"
            required
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field rounded px-3 py-2 text-sm"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field rounded px-3 py-2 text-sm"
          />

          {error && <p className="text-sm text-critical">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>

          <Link to="/forgot-password" className="text-xs text-navy underline">
            Forgot your password?
          </Link>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
