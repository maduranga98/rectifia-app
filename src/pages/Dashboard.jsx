import { useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { ROLE_LABELS } from '../constants/roles'

function Dashboard() {
  const { user, role } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          Sign out
        </button>
      </div>
      <p className="text-sm text-gray-600">
        Signed in as {user?.email}
        {role ? ` (${ROLE_LABELS[role] ?? role})` : ''}
      </p>
    </div>
  )
}

export default Dashboard
