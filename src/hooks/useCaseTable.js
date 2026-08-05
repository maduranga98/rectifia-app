import { useCallback, useEffect, useState } from 'react'
import { reassignCase } from '../services/routingService'
import { auth } from '../services/firebase'

// A clock ticking once a minute, so deadline labels stay accurate without a
// reload. The same approach ComplianceCountdown and the old dashboards used,
// lifted here so every case view shares one implementation.
export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// Reassigning a case to a different handler, shared by the All cases and
// Awaiting triage pages. The actual authority is server-side (reassignCase ->
// the callable's own checks); this only tracks which row is mid-request so the
// row can disable its own control, and refreshes the shared list on success.
export function useReassign(companyId, refresh) {
  const [reassigningId, setReassigningId] = useState(null)
  const [error, setError] = useState(null)

  const handleReassign = useCallback(
    async (caseId, handlerId) => {
      if (!handlerId) return
      setReassigningId(caseId)
      setError(null)
      try {
        await reassignCase({ caseId, companyId, handlerId, actorId: auth.currentUser?.uid })
        await refresh()
      } catch (err) {
        setError(err.message)
      } finally {
        setReassigningId(null)
      }
    },
    [companyId, refresh]
  )

  return { reassigningId, reassignError: error, handleReassign }
}
