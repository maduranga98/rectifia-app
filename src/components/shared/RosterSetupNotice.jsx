import { Link } from 'react-router-dom'
import Alert from '../ui/Alert'

// Nudges a Company Admin who hasn't set up anything a price could be based
// on yet - no roster, no declared estimate - toward doing so before their
// 7-day trial lapses. Renders only while all four conditions hold; any one
// of them flipping (an employee gets added, an estimate is saved, they
// subscribe, or access already got blocked) makes it disappear on its own,
// same read each render - nothing dismissible or snoozed.
//
// Plain hardcoded strings, deliberately - translation files are out of scope
// for this module, same as AccessBlockedNotice.jsx.
function RosterSetupNotice({ company }) {
  const hasRoster = (company?.currentEmployeeCount ?? 0) > 0
  const hasEstimate = company?.employeeCount != null
  const isSubscribed = !!company?.stripeSubscriptionId
  const isBlocked = company?.accessBlocked === true

  if (hasRoster || hasEstimate || isSubscribed || isBlocked) return null

  return (
    <Alert variant="warning" title="Set up your team to see pricing">
      <p>
        Add employees to your{' '}
        <Link to="/admin/employees" className="font-medium underline">
          roster
        </Link>
        , or enter an estimated headcount on the{' '}
        <Link to="/admin/billing" className="font-medium underline">
          Billing page
        </Link>
        , so Rectifia can show you a price and you can subscribe before your 7-day trial ends.
      </p>
    </Alert>
  )
}

export default RosterSetupNotice
