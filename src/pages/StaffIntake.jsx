import { useAuth } from '../contexts/AuthContext'
import { ROLES } from '../constants/roles'
import StaffIntakeForm from '../components/intake/StaffIntakeForm'
import Alert from '../components/ui/Alert'

// Page body for staff-initiated intake, mounted inside the dashboard shell at
// /dashboard/intake. It no longer renders its own AppShell: intake is one page
// among the dashboard's nav entries, so it shares the same shell and nav as
// every other staff surface rather than swapping in a two-item nav of its own.
//
// The role gate here is presentation. What actually stops a Company Admin
// reaching this is requireIntakeRole() in functions/src/utils/staffAuth.js,
// which the createCaseOnBehalf callable runs before it reads anything else
// from the request - a bookmarked URL or a hand-rolled call gets a
// permission-denied, not a case.
const INTAKE_ROLES = [ROLES.CASE_HANDLER, ROLES.HR_COORDINATOR]

function StaffIntake() {
  const { role, companyId } = useAuth()

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

  return <StaffIntakeForm companyId={companyId} />
}

export default StaffIntake
