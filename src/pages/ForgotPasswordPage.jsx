import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { sendPasswordReset } from '../services/authService'
import AuthLayout from '../components/shared/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Field'

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await sendPasswordReset(email)
      setSuccess(t('forgotPassword.successMessage'))
    } catch (err) {
      // Never reveal whether the address has an account - user-not-found
      // gets the same success message as a real send.
      if (err.code === 'auth/user-not-found') {
        setSuccess(t('forgotPassword.successMessage'))
      } else {
        setError(t('forgotPassword.errorMessage'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={t('forgotPassword.title')}
      description={t('forgotPassword.description')}
      footer={
        <Link to="/login" className="font-medium text-navy hover:underline">
          {t('forgotPassword.backToSignIn')}
        </Link>
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

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          icon="mail"
          loading={submitting}
          loadingLabel={t('forgotPassword.sending')}
        >
          {t('forgotPassword.sendResetLink')}
        </Button>
      </form>
    </AuthLayout>
  )
}

export default ForgotPasswordPage
