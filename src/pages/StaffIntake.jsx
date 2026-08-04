import { useNavigate } from 'react-router-dom'
import { signOutUser } from '../services/authService'
import { useAuth } from '../contexts/AuthContext'
import { ROLES, ROLE_LABELS } from '../constants/roles'
import AppShell from '../components/shared/AppShell'
import StaffIntakeForm from '../components/intake/StaffIntakeForm'
import Alert from '../components/ui/Alert'

// Page shell for staff-initiated intake, at /intake.
//
// Inside AppShell, not ReporterLayout: this is an authenticated staff surface
// and should look like one. ReporterLayout's chrome is built for someone who
// may be filing from a phone in a car park and is deliberately free of any
// signed-in furniture; putting this form inside it would tell a staff member
// they are somewhere anonymous when every action they take here is attributed
// to their account and written to the intake audit log.
//
// The role gate here is presentation. What actually stops a Company Admin
// reaching this is requireIntakeRole() in functions/src/utils/staffAuth.js,
// which the createCaseOnBehalf callable runs before it reads anything else
// from the request - a bookmarked URL or a hand-rolled call gets a
// permission-denied, not a case.
const INTAKE_ROLES = [ROLES.CASE_HANDLER, ROLES.HR_COORDINATOR]

function StaffIntake() {
  const { user, role, companyId } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOutUser()
    navigate('/login', { replace: true })
  }

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: 'cases' },
    { to: '/intake', label: 'File a report', icon: 'plus' },
  ]

  function renderBody() {
    if (!companyId) {
      return (
        <Alert variant="error" title="Account not linked to a company">
          This account is not linked to a company, so there is no queue to file a case into. Ask
          your Company Admin to re-issue the invite.
        </Alert>
      )
    }

    if (!INTAKE_ROLES.includes(role)) {
      return (
        <Alert variant="error" title="This surface is for Case Handlers and HR Coordinators">
          Filing a case means reading and recording the whole report, so it is limited to the
          two roles that handle case content. Ask a Case Handler or HR Coordinator to take the
          report.
        </Alert>
      )
    }

    return <StaffIntakeForm />
  }

  return (
    <AppShell
      scopeLabel={role ? ROLE_LABELS[role] ?? role : 'Staff'}
      navItems={navItems}
      userEmail={user?.email}
      roleLabel={role ? ROLE_LABELS[role] ?? role : 'Staff'}
      onSignOut={handleSignOut}
      eyebrow="Intake"
      title="File a report on someone's behalf"
    >
      {renderBody()}
    </AppShell>
  )
}

export default StaffIntake
