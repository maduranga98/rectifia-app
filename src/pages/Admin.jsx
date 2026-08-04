import { useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import AppHeader from '../components/shared/AppHeader'
import CompanyAdminPanel from '../components/dashboard/CompanyAdminPanel'

// The Company Admin surface. CompanyAdminPanel (departments, staff, routing
// rules, billing) already existed but was not rendered on any route, so a
// Company Admin who signed in landed on an empty page with none of it
// reachable - the same gap CompanySetup had on the Super Admin side.
//
// companyId comes from the custom claim, not a URL param or a form field: a
// Company Admin can only ever administer the company stamped on their own
// token, and firestore.rules enforces that independently.
function Admin() {
  const { user, companyId } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Rectifia"
        subtitle="Company administration"
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

      {companyId ? (
        <CompanyAdminPanel companyId={companyId} />
      ) : (
        // No companyId claim means the account was never linked to a company
        // - an empty panel would look like the company had no data, so say
        // what is actually wrong.
        <div className="mx-auto max-w-4xl p-6">
          <p className="text-sm text-critical">
            This account ({user?.email}) is not linked to a company, so there
            is nothing to administer. Ask Lumora to re-issue the account.
          </p>
        </div>
      )}
    </div>
  )
}

export default Admin
