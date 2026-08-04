import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { signIn, getUserClaims } from '../services/authService'
import { ROLES } from '../constants/roles'

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

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const user = await signIn(email, password)
      const { role } = await getUserClaims(user)
      navigate(role === ROLES.SUPER_ADMIN ? '/super-admin' : '/dashboard', { replace: true })
    } catch (err) {
      setError('Incorrect email or password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Staff sign in</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-gray-200 p-4">
          <input
            type="email"
            required
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>

          <Link to="/forgot-password" className="text-xs text-blue-600 underline">
            Forgot your password?
          </Link>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
