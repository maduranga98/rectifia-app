import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signIn, signOutUser, getUserClaims } from '../services/authService'
import { ROLES } from '../constants/roles'

// Platform-level login, deliberately separate from the staff LoginPage:
// different route, different heading, dark theme so it never gets mistaken
// for a company-scoped sign-in. Same Firebase Auth mechanism underneath,
// but only role === 'super_admin' may proceed past this page - anyone else
// gets an access-denied message here, never a redirect into a company
// dashboard.
function SuperAdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const user = await signIn(email, password)
      const { role } = await getUserClaims(user)
      if (role !== ROLES.SUPER_ADMIN) {
        await signOutUser()
        setError('Access denied. This sign-in is for Lumora platform administrators only.')
        return
      }
      navigate('/super-admin', { replace: true })
    } catch (err) {
      setError('Incorrect email or password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 p-6">
      <div className="flex w-full max-w-md flex-col gap-3">
        <h1 className="text-xl font-semibold text-white">Lumora Platform Admin</h1>
        <p className="text-sm text-gray-400">Super Admin access only - not scoped to any company.</p>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded border border-gray-700 bg-gray-800 p-4"
        >
          <input
            type="email"
            required
            placeholder="admin@lumora.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default SuperAdminLoginPage
