import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ROLES } from '../../constants/roles'
import Alert from '../ui/Alert'

// Shown in place of a blocked growth action (inviting staff, adding an
// employee) once a company's 7-day trial has lapsed without a subscription -
// see useCompanyBlocked.js for how `blocked` is resolved and
// functions/src/utils/staffAuth.js's requireCompanyNotBlocked for the
// server-side enforcement this only mirrors.
//
// Plain hardcoded strings, deliberately - translation files are out of scope
// for this module, unlike the rest of this app's user-facing text.
function AccessBlockedNotice({ titleKey }) {
  const { role } = useAuth()
  const isCompanyAdmin = role === ROLES.COMPANY_ADMIN
  const title = titleKey || 'Your trial has ended'

  return (
    <Alert variant="warning" title={title}>
      {isCompanyAdmin ? (
        <p>
          Your 7-day trial ended without a subscription, so adding new staff or employees is paused. Existing
          cases, investigations, and staff sign-in are unaffected -{' '}
          <Link to="/admin/billing" className="font-medium underline">
            subscribe
          </Link>{' '}
          to lift this immediately.
        </p>
      ) : (
        <p>
          This company's trial has ended without a subscription, so adding new staff or employees is paused
          until your Company Admin subscribes.
        </p>
      )}
    </Alert>
  )
}

export default AccessBlockedNotice
