import { useCallback, useEffect, useState } from 'react'
import { listPulseResponses, listPulseSummaries } from '../../services/pulseCheckService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import Icon from '../ui/Icon'

const TREND_TONE = {
  improving: 'tone-low',
  stable: 'tone-neutral',
  declining: 'tone-critical',
  insufficient_data: 'tone-neutral',
}

const SENTIMENT_TONE = (score) => {
  if (score === null || score === undefined) return 'tone-neutral'
  if (score < 40) return 'tone-critical'
  if (score < 60) return 'tone-medium'
  return 'tone-low'
}

const RAIL = {
  'tone-critical': 'bg-critical',
  'tone-medium': 'bg-medium',
  'tone-low': 'bg-low',
  'tone-neutral': 'bg-navy-200',
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
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

  if (error) return <Alert variant="error">{error}</Alert>

  if (summaries.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState
          icon="pulse"
          title="No pulse data yet"
          description="Department averages appear here once your team starts submitting pulse checks."
        />
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {summaries.map((s) => {
        const tone = SENTIMENT_TONE(s.averageSentiment)
        return (
          <Card key={s.id} className="relative overflow-hidden p-5 pl-6">
            <span
              className={`absolute inset-y-0 left-0 w-1 ${RAIL[tone] ?? RAIL['tone-neutral']}`}
              aria-hidden="true"
            />
            <p className="truncate font-medium text-charcoal">{s.department}</p>
            <p className="text-xs text-muted">{s.period}</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-charcoal">
              {s.averageSentiment ?? '-'}
            </p>
            <p className="text-xs text-muted">
              avg. sentiment across {s.responseCount} response{s.responseCount === 1 ? '' : 's'}
            </p>
          </Card>
        )
      })}
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

  if (error) return <Alert variant="error">{error}</Alert>

  if (responses.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState
          icon="pulse"
          title="No responses yet"
          description="Individual pulse check responses and their AI summaries land here as they come in."
        />
      </Card>
    )
  }

  const crisisCount = responses.filter((r) => r.crisisFlag).length

  return (
    <div className="flex flex-col gap-4">
      {crisisCount > 0 && (
        <Alert variant="error" title={`${crisisCount} response${crisisCount === 1 ? '' : 's'} flagged for crisis`}>
          Crisis contact has already been triggered automatically for these.
        </Alert>
      )}

      <Card
        title="Individual responses"
        description={`${responses.length} response${responses.length === 1 ? '' : 's'}`}
        padded={false}
      >
        <ul className="divide-y divide-line-soft">
          {responses.map((r) => (
            <li key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal">{r.employeeId}</p>
                  <p className="text-xs text-muted">{r.department ?? 'Unspecified department'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {r.crisisFlag && (
                    <Badge tone="tone-critical" icon="alert">
                      Crisis flagged
                    </Badge>
                  )}
                  <Badge tone={TREND_TONE[r.trendFlag] ?? 'tone-neutral'} dot>
                    {humanize(r.trendFlag) ?? 'pending analysis'}
                  </Badge>
                </div>
              </div>

              {r.sentimentSummary && <p className="mt-2 text-sm text-charcoal">{r.sentimentSummary}</p>}

              {Array.isArray(r.themes) && r.themes.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Icon name="sparkle" className="h-3.5 w-3.5 text-subtle" />
                  {r.themes.map((theme) => (
                    <Badge key={theme} tone="tone-neutral">
                      {theme}
                    </Badge>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
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
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        {canSeeIndividualResponses
          ? 'Individual pulse check responses with their AI sentiment summaries.'
          : 'Department and period averages. Individual responses are never attributed to a person here.'}
      </p>

      {canSeeIndividualResponses ? (
        <IndividualResponsesView companyId={companyId} />
      ) : (
        <ManagerAggregateView companyId={companyId} />
      )}
    </div>
  )
}

export default PulseTrendDashboard
