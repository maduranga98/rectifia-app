import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
function statusMeta(t) {
  return {
    [FOLLOW_UP_STATUS.SCHEDULED]: {
      label: t('followUpStatus.meta.scheduled.label'),
      tone: 'tone-neutral',
      hint: t('followUpStatus.meta.scheduled.hint'),
    },
    [FOLLOW_UP_STATUS.SENT]: {
      label: t('followUpStatus.meta.sent.label'),
      tone: 'tone-info',
      hint: t('followUpStatus.meta.sent.hint'),
    },
    [FOLLOW_UP_STATUS.ANSWERED_NO_CHANGE]: {
      label: t('followUpStatus.meta.answeredNoChange.label'),
      tone: 'tone-low',
      hint: t('followUpStatus.meta.answeredNoChange.hint'),
    },
    [FOLLOW_UP_STATUS.ANSWERED_CONCERN]: {
      label: t('followUpStatus.meta.answeredConcern.label'),
      tone: 'tone-critical',
      hint: t('followUpStatus.meta.answeredConcern.hint'),
    },
    [FOLLOW_UP_STATUS.DECLINED]: {
      label: t('followUpStatus.meta.declined.label'),
      tone: 'tone-neutral',
      hint: t('followUpStatus.meta.declined.hint'),
    },
    [FOLLOW_UP_STATUS.NO_RESPONSE]: {
      label: t('followUpStatus.meta.noResponse.label'),
      tone: 'tone-neutral',
      hint: t('followUpStatus.meta.noResponse.hint'),
    },
  }
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
  const { t } = useTranslation()
  const STATUS_META = useMemo(() => statusMeta(t), [t])
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
      title={t('followUpStatus.title')}
      description={t('followUpStatus.description')}
    >
      {total === 0 ? (
        <EmptyState
          compact
          icon="clock"
          title={t('followUpStatus.empty.title')}
          description={t('followUpStatus.empty.description')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {concernCount > 0 && (
            <div className="rounded-lg border border-critical-200 bg-surface p-3 text-sm text-charcoal">
              <Trans
                i18nKey="followUpStatus.concernNotice"
                count={concernCount}
                components={{ strong: <strong /> }}
              />
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

          <p className="text-xs text-subtle">{t('followUpStatus.noResponseFootnote')}</p>
        </div>
      )}
    </Card>
  )
}

export default FollowUpStatus
