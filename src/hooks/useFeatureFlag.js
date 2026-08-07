import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getCompany } from '../services/companyService'
import { resolveFeatureFlag } from '../config/featureFlags'

// Resolves one per-company feature flag for the signed-in staff member's own
// company (never a company id from a prop or the URL - always the caller's
// own companyId claim, so this can never be used to probe another
// company's configuration). Reads companies/{companyId} fresh on mount and
// on every companyId change.
//
// No realtime listener, on purpose and matching every other company setting
// already read this way in this app (pulseCheckCadence, jurisdictions, ...):
// none of them push live updates to an already-open session either. A flag a
// Super Admin just flipped takes effect for a signed-in staff member on
// their next page load, not this millisecond - fine for a kill switch that
// exists to stop new use, not to interrupt someone already mid-task.
//
// This hook is UX only: hiding a nav entry or a route with it stops a
// disabled feature from dangling in front of someone who can't use it, but
// hiding it is never itself the enforcement - see
// functions/src/utils/featureFlags.js for the server-side check that is.
// The returned `enabled` starts at the flag's own registry default (not a
// hardcoded true) so a slow read never flashes a benchmarkPool- or
// externalShareLinks-style default-off feature on before flipping off.
export function useFeatureFlag(key) {
  const { companyId } = useAuth()
  const [enabled, setEnabled] = useState(() => resolveFeatureFlag(null, key))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    if (!companyId) {
      // No company to read - the registry default already sitting in state
      // (the useState initializer above) is the right answer, so there is
      // nothing to set here beyond ending the loading state.
      setLoading(false)
      return undefined
    }

    setLoading(true)
    getCompany(companyId)
      .then((company) => {
        if (cancelled) return
        setEnabled(resolveFeatureFlag(company?.featureFlags, key))
      })
      .catch(() => {
        // A failed read resolves to the registry default rather than
        // hiding the feature outright - the read failing is not itself a
        // signal that the company turned the feature off.
        if (!cancelled) setEnabled(resolveFeatureFlag(null, key))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [companyId, key])

  return { enabled, loading }
}
