import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sendPasswordReset } from '../services/authService'

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
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
          <span className="text-lg font-semibold tracking-tight text-navy">Rectifia</span>
        </div>
        <h1 className="text-xl font-semibold">Reset your password</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <input
            type="email"
            required
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field rounded px-3 py-2 text-sm"
          />

          {error && <p className="text-sm text-critical">{error}</p>}
          {success && <p className="text-sm text-low">{success}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send reset link'}
          </button>

          <Link to="/login" className="text-xs text-navy underline">
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  )
}

export default ForgotPasswordPage
