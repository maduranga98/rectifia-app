import { useState } from 'react'
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { signIn } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import AuthLayout from '../components/shared/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Field'

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
  const { user: currentUser, loading } = useAuth()

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await signIn(email, password)
      // Return the user to whatever ProtectedRoute bounced them off of,
      // otherwise hand off to "/" - RootRedirect is the single place that
      // decides which dashboard a role belongs on (a Company Admin, for
      // one, belongs on /admin, not /dashboard).
      navigate(location.state?.from?.pathname ?? '/', { replace: true })
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
    return <Navigate to="/" replace />
  }

  return (
    <AuthLayout
      title="Staff sign in"
      description="Use the account your Company Admin issued you."
      footer={
        <p>
          Reporting something? You do not need an account - use the case link or Case ID you
          were given.
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
        <Input
          label="Work email"
          type="email"
          required
          autoComplete="email"
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <Alert variant="error">{error}</Alert>}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={submitting}
          loadingLabel="Signing in"
        >
          Sign in
        </Button>

        <Link
          to="/forgot-password"
          className="self-center text-sm font-medium text-navy hover:text-navy-600 hover:underline"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthLayout>
  )
}

export default LoginPage
