import { useCallback, useEffect, useState } from 'react'
import { listPulseResponses, listPulseSummaries } from '../../services/pulseCheckService'

const TREND_STYLE = {
  improving: 'border-green-200 bg-green-50 text-green-700',
  stable: 'border-gray-200 bg-gray-50 text-gray-600',
  declining: 'border-red-300 bg-red-50 text-red-700',
  insufficient_data: 'border-gray-200 bg-gray-50 text-gray-400',
}

// Manager-facing view. This ONLY ever calls listPulseSummaries -
// department/period aggregates with no individual attribution - never
// listPulseResponses. That's a genuinely different data source populated by
// a Cloud Function aggregation step (functions/src/intake/
// analyzePulseResponse.js), not a client-side filter of individual records,
// and firestore.rules backs that up: the manager role has no read path to
// pulseResponses at all.
function ManagerAggregateView({ companyId }) {
  const [summaries, setSummaries] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    listPulseSummaries(companyId).then(setSummaries).catch((err) => setError(err.message))
  }, [companyId])

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-700">Team wellness (aggregate)</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summaries.map((s) => (
          <div key={s.id} className="rounded border border-gray-200 p-4">
            <p className="font-medium">{s.department}</p>
            <p className="text-xs text-gray-500">{s.period}</p>
            <p className="mt-2 text-2xl font-semibold">{s.averageSentiment ?? '-'}</p>
            <p className="text-xs text-gray-400">avg. sentiment - {s.responseCount} response(s)</p>
          </div>
        ))}
      </div>
      {summaries.length === 0 && !error && <p className="text-sm text-gray-500">No pulse data yet.</p>}
    </div>
  )
}

// HR Coordinator / Pulse Check Reviewer view - the only roles that ever see
// a named individual response and its AI summary. Reachable only because
// firestore.rules grants those two roles (and only those two) read access
// to pulseResponses/{responseId}.
function IndividualResponsesView({ companyId }) {
  const [responses, setResponses] = useState([])
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const rows = await listPulseResponses(companyId)
      setResponses(rows.sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0)))
    } catch (err) {
      setError(err.message)
    }
  }, [companyId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-700">Individual responses</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="flex flex-col gap-3">
        {responses.map((r) => (
          <li key={r.id} className="rounded border border-gray-200 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.employeeId}</span>
              <span
                className={`rounded border px-2 py-0.5 text-xs ${TREND_STYLE[r.trendFlag] ?? TREND_STYLE.insufficient_data}`}
              >
                {r.trendFlag ?? 'pending analysis'}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">{r.department ?? 'Unspecified department'}</p>
            {r.sentimentSummary && <p className="mt-2">{r.sentimentSummary}</p>}
            {Array.isArray(r.themes) && r.themes.length > 0 && (
              <p className="mt-1 text-xs text-gray-400">Themes: {r.themes.join(', ')}</p>
            )}
            {r.crisisFlag && (
              <p className="mt-2 text-xs font-semibold text-red-600">Crisis flagged - contact triggered</p>
            )}
          </li>
        ))}
      </ul>
      {responses.length === 0 && !error && <p className="text-sm text-gray-500">No responses yet.</p>}
    </div>
  )
}

// Renders one of two entirely separate views depending on role. A manager
// never receives the branch that can see pulseResponses - not because this
// component chooses to hide it, but because that branch's own data call
// would be denied by firestore.rules for a manager's auth token.
function PulseTrendDashboard({ companyId, role }) {
  const canSeeIndividualResponses = role === 'hrCoordinator' || role === 'pulseCheckReviewer'

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold">Pulse check trends</h1>
      {canSeeIndividualResponses ? <IndividualResponsesView companyId={companyId} /> : <ManagerAggregateView companyId={companyId} />}
    </div>
  )
}

export default PulseTrendDashboard
