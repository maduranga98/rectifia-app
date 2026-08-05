import { useEffect, useMemo, useState } from 'react'
import { ROLES } from '../../constants/roles'
import { AggregateTrendsView } from '../../components/pulse-check/PulseTrendDashboard'
import { listQuestionSetVersions } from '../../services/pulseQuestionService'
import Card from '../../components/ui/Card'

// Department and period sentiment averages - never an individual response.
// Two roles land here with two scopings, both enforced by firestore.rules and
// unchanged from before the split:
//   - Manager ("Team wellness"): scoped to the account's own department claim.
//     Its scoping and suppression behaviour must not change, so the manager's
//     `departments` are passed straight through to the aggregate query.
//   - Pulse Check Reviewer ("Trends"): reads every company aggregate; passing
//     no departments is the unconditional read its rules path already allows.

// Firestore Timestamps arrive from a document read with .toMillis(); the same
// value through a callable is a plain {_seconds} object. Both are handled.
function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value._seconds === 'number') return value._seconds * 1000
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return null
}

// The period key an aggregate is filed under - must match currentPeriod() in
// functions/src/intake/analyzePulseResponse.js exactly (UTC year-month), or a
// publish marker would land on the wrong card.
function periodOf(ms) {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// Where the questionnaire changed, shown alongside the averages it sits under.
//
// A trend line invites one reading - people feel better or worse than they did -
// and that reading is only safe if the question stayed the same. Core questions
// do stay the same, by design, which is why averages remain comparable across
// these boundaries at all. This panel is what lets a reader confirm that rather
// than assume it: it shows every point at which the questionnaire was
// republished, and whether the change touched the standard questions (a Lumora
// code change) or only the company's own added ones.
function QuestionSetTimeline({ versions }) {
  if (versions.length === 0) return null

  return (
    <Card
      title="Questionnaire changes"
      description="Each point where this company republished its check-in questions."
      padded={false}
    >
      <ul className="divide-y divide-line-soft">
        {[...versions].reverse().map((v, index, list) => {
          const ms = toMillis(v.publishedAt)
          const previous = list[index + 1]
          const coreChanged = previous && previous.coreVersion !== v.coreVersion
          const added = (v.questions ?? []).filter((q) => q.tier === 'supplementary').length
          return (
            <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
              <span className="text-sm font-medium text-charcoal">Version {v.version}</span>
              <span className="text-xs text-muted">
                {ms ? formatDate(ms) : 'date unavailable'}
                {ms && ` · period ${periodOf(ms)}`}
              </span>
              <span className="text-xs text-muted">
                {added === 0
                  ? 'standard questions only'
                  : `${added} added question${added === 1 ? '' : 's'}`}
              </span>
              {coreChanged && (
                <span className="text-xs text-medium">
                  standard questions were reworded at this point
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">
        Averages stay comparable across these boundaries: they are calculated from the four
        standard questions only, which no company can change. A company&apos;s own added questions
        never feed an average or a trend.
      </p>
    </Card>
  )
}

function PulseTrendsPage({ companyId, role, departments }) {
  const scopedDepartments = role === ROLES.MANAGER ? departments : undefined
  // Read once here and shared by both consumers below - the per-card markers
  // and the timeline panel are two views of the same list.
  const [versions, setVersions] = useState([])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    listQuestionSetVersions(companyId)
      .then((rows) => {
        if (!cancelled) setVersions(rows)
      })
      // A failure here must not take the averages down with it - the trend view
      // is the page, the question history is context for it.
      .catch((err) => console.error('listQuestionSetVersions failed', err))
    return () => {
      cancelled = true
    }
  }, [companyId])

  const publishPeriods = useMemo(() => {
    const periods = new Set()
    for (const v of versions) {
      const ms = toMillis(v.publishedAt)
      if (ms) periods.add(periodOf(ms))
    }
    return periods
  }, [versions])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        Department and period averages. Individual responses are never attributed to a person here.
      </p>
      <AggregateTrendsView
        companyId={companyId}
        departments={scopedDepartments}
        publishPeriods={publishPeriods}
      />
      <QuestionSetTimeline versions={versions} />
    </div>
  )
}

export default PulseTrendsPage
