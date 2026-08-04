import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sendPasswordReset } from '../services/authService'
import AuthLayout from '../components/shared/AuthLayout'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Field'

function ForgotPasswordPage() {
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
      setSuccess('If an account exists for that email, a password reset link has been sent.')
    } catch (err) {
      // Never reveal whether the address has an account - user-not-found
      // gets the same success message as a real send.
      if (err.code === 'auth/user-not-found') {
        setSuccess('If an account exists for that email, a password reset link has been sent.')
      } else {
        setError('Could not send the reset email. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="We'll email you a link to set a new one."
      footer={
        <Link to="/login" className="font-medium text-navy hover:underline">
          Back to sign in
        </Link>
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

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          icon="mail"
          loading={submitting}
          loadingLabel="Sending"
        >
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  )
}

export default ForgotPasswordPage
