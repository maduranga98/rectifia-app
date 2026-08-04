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
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Reset your password</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-gray-200 p-4">
          <input
            type="email"
            required
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send reset link'}
          </button>

          <Link to="/login" className="text-xs text-blue-600 underline">
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  )
}

export default ForgotPasswordPage
