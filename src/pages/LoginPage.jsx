import { useState } from 'react'
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          ? t('login.errors.invalidCredentials')
          : t('login.errors.generic')
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
      title={t('login.title')}
      description={t('login.description')}
      footer={
        <div className="flex flex-col gap-3">
          <p>{t('login.reportingNotice')}</p>
          <p className="flex gap-4 text-xs">
            <Link to="/privacy" className="underline hover:text-charcoal">
              {t('reporterLayout.privacyPolicy')}
            </Link>
            <Link to="/terms" className="underline hover:text-charcoal">
              {t('reporterLayout.termsOfUse')}
            </Link>
          </p>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="card flex flex-col gap-4 p-6">
        <Input
          label={t('login.workEmail')}
          type="email"
          required
          autoComplete="email"
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label={t('login.password')}
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
          loadingLabel={t('login.signingIn')}
        >
          {t('login.signIn')}
        </Button>

        <Link
          to="/forgot-password"
          className="self-center text-sm font-medium text-navy hover:text-navy-600 hover:underline"
        >
          {t('login.forgotPassword')}
        </Link>
      </form>
    </AuthLayout>
  )
}

export default LoginPage
