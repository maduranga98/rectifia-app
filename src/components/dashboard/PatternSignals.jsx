import { useCallback, useEffect, useState } from 'react'
import {
  CASE_COUNT_CAVEAT,
  CROSS_CATEGORY_CAVEAT,
  SIGNAL_TYPE_LABEL,
  SIGNAL_TYPE_TONE,
  describeSignal,
  formatSignalDate,
  getPatternSignalSummary,
  listCompanyPatternSignals,
} from '../../services/patternService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { SkeletonList } from '../ui/Loading'

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

// Same-category signals first, then by recency: a cluster of one kind of
// report is the stronger of the two and should not be buried under weaker
// cross-category rows.
function sortSignals(signals) {
  return [...signals].sort((a, b) => {
    if (a.signalType !== b.signalType) return a.signalType === 'same_category' ? -1 : 1
    return (b.caseCount ?? 0) - (a.caseCount ?? 0)
  })
}

// Explains an empty or short list rather than leaving one. A group is withheld
// when too few employees match its department and role tier - at that size the
// pair is an identity, and showing the count would name someone. Saying so is
// the point: an HR Coordinator who sees nothing needs to know whether that
// means "no pattern" or "a pattern that cannot be reported safely", and the
// difference matters to what they do next.
function SuppressionNotice({ summary }) {
  if (!summary || !summary.suppressedCount) return null

  const groupWord = summary.suppressedCount === 1 ? 'group' : 'groups'
  return (
    <Alert variant="info" title="Not enough people in this group to report safely">
      <p>
        {summary.suppressedCount} {groupWord} reached the threshold but {summary.suppressedCount === 1 ? 'was' : 'were'}{' '}
        withheld: fewer than {summary.minPopulation} employees match the department and role tier
        {summary.suppressedByMissingDirectory > 0 && ', or the employee directory has no entry for that department'}.
        In a group that small, a department and a role tier identify a person, so the signal is not
        shown at all rather than shown less precisely.
      </p>
      <p className="mt-1.5 text-xs">
        Which {groupWord} deliberately {summary.suppressedCount === 1 ? 'is' : 'are'} not named here -
        naming {summary.suppressedCount === 1 ? 'it' : 'them'} would be the same disclosure.
      </p>
    </Alert>
  )
}

// Company-wide pattern signals for the HR Coordinator. Every row is a count
// over a rolling window and nothing more: no name, no questionnaire answer, no
// case link, no recommended action, no judgement about the department or
// anyone in it. Case ids are on the underlying document for the assigned
// handler's own-case check and for report compilation - this screen never
// renders them, and reading one would not grant this role access to the case
// anyway.
function PatternSignals({ companyId }) {
  const [signals, setSignals] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [signalRows, summaryRow] = await Promise.all([
        listCompanyPatternSignals(companyId),
        getPatternSignalSummary(companyId),
      ])
      setSignals(sortSignals(signalRows))
      setSummary(summaryRow)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const windowDays = summary?.windowDays ?? signals[0]?.windowDays ?? 180

  return (
    <Card
      title="Pattern signals"
      description={`Repeat reports grouped by department and role tier over the last ${windowDays} days. Recomputed daily.`}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert variant="error">{error}</Alert>}

        {loading && signals.length === 0 ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {signals.length === 0 ? (
              <EmptyState
                compact
                icon="search"
                title="No pattern signals"
                description={`No department and role tier reached the reporting threshold in the last ${windowDays} days.`}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {signals.map((signal) => (
                  <li key={signal.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium capitalize text-charcoal">
                        {signal.department}
                      </span>
                      <Badge tone="tone-neutral">{humanize(signal.roleTier)}</Badge>
                      <Badge tone={SIGNAL_TYPE_TONE[signal.signalType] ?? 'tone-neutral'} dot>
                        {SIGNAL_TYPE_LABEL[signal.signalType] ?? humanize(signal.signalType)}
                      </Badge>
                      {signal.category && (
                        <span className="text-xs text-muted">{humanize(signal.category)}</span>
                      )}
                    </div>

                    <p className="text-sm text-charcoal">{describeSignal(signal)}</p>

                    <p className="text-xs text-muted">
                      First {formatSignalDate(signal.firstReportedAt)}, most recent{' '}
                      {formatSignalDate(signal.lastReportedAt)}.
                    </p>

                    {signal.signalType === 'cross_category' && (
                      <p className="text-xs text-muted">{CROSS_CATEGORY_CAVEAT}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <SuppressionNotice summary={summary} />

            {/* Stated on the screen, not just in the data model: a reader who
                assumes four cases means four people will over-read every row
                here, and anonymous reporting makes that assumption
                unverifiable in principle. */}
            <p className="text-xs text-muted">{CASE_COUNT_CAVEAT}</p>
          </>
        )}
      </div>
    </Card>
  )
}

export default PatternSignals
