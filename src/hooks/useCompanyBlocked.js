import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getCompany } from '../services/companyService'

// Resolves companies/{companyId}.accessBlocked for the signed-in user's own
// company (never a prop or URL param - always the caller's own companyId
// claim, matching useFeatureFlag.js's identical rule). Reads
// companies/{companyId} fresh on mount and on every companyId change.
//
// No realtime listener, on purpose and matching useFeatureFlag.js and every
// other company-setting read in this app: a block that was just lifted by
// subscribing takes effect on the next page load, not this millisecond.
//
// This hook is UX only: swapping a blocked growth action for
// AccessBlockedNotice stops the form from dangling in front of someone who
// can't use it, but hiding it is never itself the enforcement - see
// functions/src/utils/staffAuth.js's requireCompanyNotBlocked and the inline
// checks in addEmployee.js/bulkAddEmployees.js for the server-side check
// that is. `blocked` starts false so a slow read never flashes the notice on
// before resolving.
//
// Also exposes the fetched `company` document itself, so callers that need
// another field off the same read (RosterSetupNotice's roster/estimate/
// subscription checks in Admin.jsx) don't have to fetch it a second time.
export function useCompanyBlocked() {
  const { companyId } = useAuth()
  const [company, setCompany] = useState(null)
  const [blocked, setBlocked] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    if (!companyId) {
      setLoading(false)
      return undefined
    }

    setLoading(true)
    getCompany(companyId)
      .then((fetchedCompany) => {
        if (cancelled) return
        setCompany(fetchedCompany)
        setBlocked(fetchedCompany?.accessBlocked === true)
      })
      .catch(() => {
        // A failed read resolves to "not blocked" rather than hiding a
        // growth action outright - the read failing is not itself a signal
        // that the company's trial has lapsed.
        if (!cancelled) setBlocked(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [companyId])

  return { blocked, loading, company }
}
