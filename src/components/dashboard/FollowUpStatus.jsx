import { useMemo } from 'react'
import { FOLLOW_UP_STATUS } from '../../services/followUpService'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'

// How each rollup status reads to an HR Coordinator, with its tone. This view
// is metadata only: counts and statuses, never the reporter's free-text answer
// (which is case content and never lives on a closed case at all).
//
// 'no_response' is labelled explicitly as UNKNOWN and toned neutral on purpose.
// An anonymous reporter who never returns is the expected case, not a negative
// signal - it must never be read, aggregated, or described as evidence that no
// retaliation occurred, so it is never coloured as a "good" outcome here.
const STATUS_META = {
  [FOLLOW_UP_STATUS.SCHEDULED]: { label: 'Scheduled', tone: 'tone-neutral', hint: 'Awaiting the first check-in' },
  [FOLLOW_UP_STATUS.SENT]: { label: 'Awaiting reply', tone: 'tone-info', hint: 'A check-in was posted' },
  [FOLLOW_UP_STATUS.ANSWERED_NO_CHANGE]: {
    label: 'Nothing changed',
    tone: 'tone-low',
    hint: 'Reporter answered: nothing has changed',
  },
  [FOLLOW_UP_STATUS.ANSWERED_CONCERN]: {
    label: 'Concern reported',
    tone: 'tone-critical',
    hint: 'Reporter indicated something happened',
  },
  [FOLLOW_UP_STATUS.DECLINED]: {
    label: 'Declined / opted out',
    tone: 'tone-neutral',
    hint: 'Reporter chose not to answer',
  },
  [FOLLOW_UP_STATUS.NO_RESPONSE]: {
    label: 'Unknown - no response',
    tone: 'tone-neutral',
    hint: 'Reporter did not return. This is not evidence that nothing happened.',
  },
}

const DISPLAY_ORDER = [
  FOLLOW_UP_STATUS.ANSWERED_CONCERN,
  FOLLOW_UP_STATUS.SENT,
  FOLLOW_UP_STATUS.SCHEDULED,
  FOLLOW_UP_STATUS.ANSWERED_NO_CHANGE,
  FOLLOW_UP_STATUS.DECLINED,
  FOLLOW_UP_STATUS.NO_RESPONSE,
]

// HR Coordinator view of retaliation follow-ups across the company's closed
// cases. Reads only the metadata mirror rows the dashboard already loaded
// (followUpStatus per case) - it has no path to case content, the reporter's
// answer, or any identity, and none of that is needed to show these counts.
function FollowUpStatus({ cases = [] }) {
  const counts = useMemo(() => {
    const tally = {}
    for (const c of cases) {
      if (!c.followUpStatus) continue
      tally[c.followUpStatus] = (tally[c.followUpStatus] ?? 0) + 1
    }
    return tally
  }, [cases])

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts])
  const concernCount = counts[FOLLOW_UP_STATUS.ANSWERED_CONCERN] ?? 0

  return (
    <Card
      title="Retaliation follow-ups"
      description="Post-closure check-ins with reporters. Metadata only - the reporter's answer stays with the handler of any case they choose to file."
    >
      {total === 0 ? (
        <EmptyState
          compact
          icon="clock"
          title="No follow-ups yet"
          description="Follow-ups are scheduled automatically when a case closes."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {concernCount > 0 && (
            <div className="rounded-lg border border-critical-200 bg-surface p-3 text-sm text-charcoal">
              <strong>{concernCount}</strong> reporter{concernCount === 1 ? '' : 's'} indicated
              something happened after their case closed. If they chose to file, it is a new,
              separate case in the queue with its own handler.
            </div>
          )}

          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DISPLAY_ORDER.filter((status) => counts[status]).map((status) => {
              const meta = STATUS_META[status]
              return (
                <li
                  key={status}
                  className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5"
                >
                  <div className="flex flex-col">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="mt-1 text-xs text-muted">{meta.hint}</span>
                  </div>
                  <span className="tabular-nums text-lg font-semibold text-charcoal">
                    {counts[status]}
                  </span>
                </li>
              )
            })}
          </ul>

          <p className="text-xs text-subtle">
            “Unknown - no response” means the reporter did not return, which is the expected case
            for an anonymous reporter. It is not a sign that nothing happened.
          </p>
        </div>
      )}
    </Card>
  )
}

export default FollowUpStatus
