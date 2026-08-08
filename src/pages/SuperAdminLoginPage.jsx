import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { signIn, signOutUser, checkSuperAdmin } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import Button from '../components/ui/Button'
import Icon from '../components/ui/Icon'
import Logo from '../components/ui/Logo'

// Platform-level login, deliberately separate from the staff LoginPage:
// different route, different heading, dark theme so it never gets mistaken
// for a company-scoped sign-in. Same Firebase Auth mechanism underneath,
// but only accounts listed in the superAdmins Firestore collection (doc id
// = uid, see authService.checkSuperAdmin) may proceed past this page -
// anyone else gets an access-denied message here, never a redirect into a
// company dashboard.
//
// It keeps its own dark form controls rather than the shared AuthLayout for
// exactly that reason: the visual break from the staff sign-in is the point.
function SuperAdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
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

  const darkField =
    'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white transition-colors placeholder:text-navy-300 hover:border-white/25 focus:border-gold focus:outline-none'

  return (
    <div className="auth-backdrop flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-4 text-center">
          <Logo size="lg" showWordmark={false} onDark />
          <div>
            <span className="pill border-gold/30 bg-gold/15 text-gold-200">
              <Icon name="shield" className="h-3 w-3" />
              Platform access
            </span>
            <h1 className="mt-3 text-2xl font-semibold text-white">Lumora Platform Admin</h1>
            <p className="mt-1.5 text-sm text-navy-200">
              Super Admin access only - not scoped to any company.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.06] p-6 shadow-[var(--shadow-overlay)] backdrop-blur"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-navy-200">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="admin@lumora.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={darkField}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-navy-200">Password</span>
            <div className="relative">
              <input
                type={passwordVisible ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${darkField} pr-10`}
              />
              <button
                type="button"
                onClick={() => setPasswordVisible((v) => !v)}
                aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                aria-pressed={passwordVisible}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-navy-300 transition-colors hover:text-white"
              >
                <Icon name={passwordVisible ? 'eyeOff' : 'eye'} className="h-4 w-4" />
              </button>
            </div>
          </label>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-critical-200/30 bg-critical/15 px-3 py-2.5 text-sm text-critical-200"
            >
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="accent"
            size="lg"
            className="w-full"
            loading={submitting}
            loadingLabel="Signing in"
          >
            Sign in
          </Button>
        </form>
      </div>
    </div>
  )
}

export default SuperAdminLoginPage
