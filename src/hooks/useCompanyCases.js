import { useCallback, useEffect, useState } from 'react'
import { listCompanyCaseMetadata } from '../services/caseMetadataService'
import { listCaseHandlers } from '../services/routingService'

// One shared load of the company-wide case metadata (module 13's metadata-only
// mirror) and the handler roster, for the HR Coordinator's split pages. The HR
// Overview, All cases, Awaiting triage and Follow-ups pages are all views of the
// same two reads; lifting them here means switching between those pages does not
// refetch - the fetch lives in <Dashboard>, which stays mounted for the whole
// /dashboard/* session, and each page reads the result through props.
//
// This adds no new read path: it is exactly the listCompanyCaseMetadata +
// listCaseHandlers pair HRCoordinatorDashboard already issued, moved up one
// level so several pages can share the one result. `enabled` keeps it inert for
// roles that have no rules path to caseMetadata (a Case Handler, Manager or
// Pulse reviewer) - the hook still runs, per the rules of hooks, but issues no
// query.
export function useCompanyCases(companyId, { enabled = true } = {}) {
  const [cases, setCases] = useState([])
  const [handlers, setHandlers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!enabled || !companyId) return
    setLoading(true)
    setError(null)
    try {
      const [caseRows, handlerRows] = await Promise.all([
        listCompanyCaseMetadata(companyId),
        listCaseHandlers(companyId),
      ])
      setCases(caseRows)
      setHandlers(handlerRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId, enabled])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { cases, handlers, loading, error, refresh }
}
