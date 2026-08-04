import { useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { ROLE_LABELS } from '../constants/roles'
import AppHeader from '../components/shared/AppHeader'

function Dashboard() {
  const { user, role } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Rectifia"
        subtitle={role ? ROLE_LABELS[role] ?? role : 'Staff'}
        actions={
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded border border-navy-600 px-3 py-1.5 text-sm text-white hover:bg-navy-800"
          >
            Sign out
          </button>
        }
      />

      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">Signed in as {user?.email}</p>
      </div>
    </div>
  )
}

export default Dashboard
