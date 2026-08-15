import { useCallback, useEffect, useState } from 'react'
import { listPulseResponses, listPulseSummaries } from '../../services/pulseCheckService'
import {
  getPublishedQuestionSet,
  indexQuestionSetsByVersion,
  listQuestionSetVersions,
  sortQuestions,
} from '../../services/pulseQuestionService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import Icon from '../ui/Icon'

// Mirrors functions/src/intake/pulseThresholds.js. It is duplicated rather
// than imported because that module is Admin-SDK server code in a separate
// package - this constant is only ever used to word the "hidden until N
// responses" label, never to decide suppression (the server already wrote
// suppressed/averageSentiment before this UI runs), so a drift here can change
// the copy but can never weaken the privacy floor.
const MIN_RESPONSES_FOR_AGGREGATE = 5

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

// Department/period aggregate view, with no individual attribution. This ONLY
// ever calls listPulseSummaries - a genuinely different data source populated
// by a Cloud Function aggregation step (functions/src/intake/
// analyzePulseResponse.js), not a client-side filter of individual records.
//
// Two callers, two scopings, both enforced by firestore.rules:
//   - Manager: `departments` is the manager's own claim; the query MUST carry a
//     matching where('department','in',...) or the rules reject it. A manager
//     with no departments is failed closed BEFORE querying (an unscoped query
//     the rules would reject anyway).
//   - Pulse Check Reviewer: `departments` is undefined - this role reads every
//     company aggregate unconditionally, the same rules path it already has.
// The suppression behaviour is identical for both: listPulseSummaries reads the
// pre-projected averageSentiment (null below the floor) verbatim and never
// divides a sum by a count.
// `publishPeriods` is the set of 'YYYY-MM' periods in which the questionnaire
// was republished, supplied by PulseTrendsPage. A card in one of those periods
// carries a marker, because a step in a department's average that lines up with
// a publish has a second candidate explanation - the questions changed - and a
// reader who cannot see that will attribute it entirely to how people feel.
//
// The marker is a caution, not a verdict: only supplementary questions can
// change here, and those never feed sentimentScore, so a publish is not
// expected to move the average. It is shown precisely so someone can rule that
// out rather than wonder.
export function AggregateTrendsView({ companyId, departments, publishPeriods }) {
  const [summaries, setSummaries] = useState([])
  const [error, setError] = useState(null)

  // Scoped mode (a manager) requires at least one department; unscoped mode (a
  // reviewer) passes `departments === undefined` and always queries.
  const scoped = departments !== undefined
  const hasScope = !scoped || (Array.isArray(departments) && departments.length > 0)

  useEffect(() => {
    if (!hasScope) return
    listPulseSummaries(companyId, departments)
      .then(setSummaries)
      .catch((err) => setError(err.message))
  }, [companyId, departments, hasScope])

  if (!hasScope) {
    return (
      <Alert variant="warning" title="No departments assigned to your account">
        Your account isn&apos;t scoped to any department yet, so there are no team pulse results to
        show. Ask your Company Admin to assign your department(s) to your account.
      </Alert>
    )
  }

  if (error) return <Alert variant="error">{error}</Alert>

  // An empty result now means exactly one thing - no department in your scope
  // has any responses yet - because suppressed departments are no longer
  // filtered out server-side; they come back and render as cards below. So this
  // copy no longer has to hedge between "no data" and "data hidden by the floor".
  if (summaries.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState
          icon="pulse"
          title="No responses yet"
          description="Department averages appear here once people start responding. An average is only ever shown once enough people in a department have responded that it can't stand in for a single person's answer."
        />
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {summaries.map((s) => {
        // A suppressed department is not dropped - low participation is itself
        // something a manager should see. It renders as a card showing the
        // response count and an explicit "hidden until N responses" state in
        // place of a number, never the number itself (which was never written
        // into this doc). averageSentiment is null for a suppressed department,
        // so there is nothing here to divide-out or leak.
        const tone = s.suppressed ? 'tone-neutral' : SENTIMENT_TONE(s.averageSentiment)
        const publishedThisPeriod = publishPeriods?.has?.(s.period)
        return (
          <Card key={s.id} className="relative overflow-hidden p-5 pl-6">
            <span
              className={`absolute inset-y-0 left-0 w-1 ${RAIL[tone] ?? RAIL['tone-neutral']}`}
              aria-hidden="true"
            />
            <p className="truncate font-medium text-charcoal">{s.department}</p>
            <p className="text-xs text-muted">{s.period}</p>
            {publishedThisPeriod && (
              <p className="mt-1 flex items-center gap-1 text-[0.6875rem] text-subtle">
                <Icon name="alert" className="h-3 w-3" />
                Questionnaire changed this period
              </p>
            )}
            {s.suppressed ? (
              <>
                <p className="mt-3 text-sm font-medium text-muted">Sentiment hidden</p>
                <p className="text-xs text-muted">
                  until {MIN_RESPONSES_FOR_AGGREGATE} responses &middot; {s.responseCount} so far
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-charcoal">
                  {s.averageSentiment ?? '-'}
                </p>
                <p className="text-xs text-muted">
                  avg. sentiment across {s.responseCount} response{s.responseCount === 1 ? '' : 's'}
                </p>
              </>
            )}
          </Card>
        )
      })}
    </div>
  )
}

// One response's answers, each shown beside the question that was actually put
// to the person - resolved through THAT response's own questionSetVersion, not
// the questionnaire published today.
//
// This matters most exactly when it is easiest to get wrong. A company can add,
// reword, or remove its own questions at any time, and each publish freezes a
// new version. An HR Coordinator reading a response from six months ago against
// today's questionnaire would see answers lined up under questions that were
// never asked - and there would be nothing on screen to suggest anything was
// amiss. Where a version cannot be resolved at all, the answer is shown against
// its raw id and labelled as unavailable rather than guessed at.
function ResponseAnswers({ response, questionSetsByVersion, coreFallback }) {
  const answers = Array.isArray(response.answers) ? response.answers : []
  if (answers.length === 0) return null

  const version = Number(response.questionSetVersion)
  // A response with no version at all - one submitted before this company ever
  // published, or before the questionnaire was versioned - is resolved against
  // the core set. That is not a guess: core questions are identical for every
  // company and across every version by design, so a core answer's wording is
  // known even when no version document exists. A response that names a version
  // which does not resolve gets no fallback: its supplementary wording is
  // genuinely unrecoverable and is labelled that way rather than filled in.
  const questionSet = Number.isInteger(version) ? questionSetsByVersion.get(version) : coreFallback
  const byId = new Map(sortQuestions(questionSet?.questions).map((q) => [q.id, q]))

  return (
    <div className="mt-3 flex flex-col gap-2">
      {answers.map((answer) => {
        const question = byId.get(answer.questionId)
        const blank = answer.value === '' || answer.value == null
        return (
          <div key={answer.questionId} className="rounded-lg bg-navy-50 px-3 py-2">
            <p className="text-xs text-muted">
              {question ? question.text : `Question wording unavailable (${answer.questionId})`}
              {question?.tier === 'supplementary' && (
                <span className="ml-1.5 text-subtle">· added by your company</span>
              )}
            </p>
            <p className="text-sm text-charcoal">
              {blank ? (
                <span className="text-subtle">No answer</span>
              ) : question?.type === 'scale' ? (
                <>
                  {answer.value}
                  {question.scaleLabels?.[Number(answer.value) - 1] && (
                    <span className="text-muted">
                      {' '}
                      · {question.scaleLabels[Number(answer.value) - 1]}
                    </span>
                  )}
                </>
              ) : (
                answer.value
              )}
            </p>
          </div>
        )
      })}
      <p className="text-[0.6875rem] text-subtle">
        {Number.isInteger(version)
          ? `Questionnaire version ${version} - the wording this person actually saw.`
          : 'Standard questions only - this response predates any published version.'}
      </p>
    </div>
  )
}

// HR Coordinator / Pulse Check Reviewer view - the only roles that ever see
// a named individual response and its AI summary. Reachable only because
// firestore.rules grants those two roles (and only those two) read access
// to pulseResponses/{responseId}.
export function IndividualResponsesView({ companyId }) {
  const [responses, setResponses] = useState([])
  const [questionSetsByVersion, setQuestionSetsByVersion] = useState(() => new Map())
  const [coreFallback, setCoreFallback] = useState(null)
  const [includeTests, setIncludeTests] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      // Every published version, not just the current one: each response is
      // rendered against the version it answered, and older responses point at
      // older versions.
      const [rows, versions, current] = await Promise.all([
        listPulseResponses(companyId, { includeTests }),
        listQuestionSetVersions(companyId),
        // Always resolves to something - the server falls back to the core-only
        // set for a company that has never published - so there is always a set
        // to render a version-less response against.
        getPublishedQuestionSet(companyId),
      ])
      setQuestionSetsByVersion(indexQuestionSetsByVersion(versions))
      setCoreFallback(current.published)
      setResponses(rows.sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0)))
    } catch (err) {
      setError(err.message)
    }
  }, [companyId, includeTests])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (error) return <Alert variant="error">{error}</Alert>

  const crisisCount = responses.filter((r) => r.crisisFlag).length

  // The test filter is rendered above the empty state, not inside the populated
  // branch: someone who has just turned tests ON and found nothing needs the
  // toggle in front of them to turn it back off.
  const testFilter = (
    <label className="flex cursor-pointer items-center gap-2 self-start text-xs text-muted">
      <input
        type="checkbox"
        checked={includeTests}
        onChange={(e) => setIncludeTests(e.target.checked)}
        className="h-3.5 w-3.5"
      />
      Show test check-ins
    </label>
  )

  if (responses.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {testFilter}
        <Card padded={false}>
          <EmptyState
            icon="pulse"
            title="No responses yet"
            description="Individual pulse check responses and their AI summaries land here as they come in."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {crisisCount > 0 && (
        <Alert variant="error" title={`${crisisCount} response${crisisCount === 1 ? '' : 's'} flagged for crisis`}>
          Crisis contact has already been triggered automatically for these.
        </Alert>
      )}

      {testFilter}

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
                  {r.isTest && <Badge tone="tone-neutral">Test</Badge>}
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

              {r.isTest && (
                <p className="mt-2 text-xs text-muted">
                  A staff member&apos;s own test of the check-in link. It is not analysed and is
                  excluded from every average and every trend.
                </p>
              )}

              {r.sentimentSummary && <p className="mt-2 text-sm text-charcoal">{r.sentimentSummary}</p>}

              <ResponseAnswers
                response={r}
                questionSetsByVersion={questionSetsByVersion}
                coreFallback={coreFallback}
              />

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

// This component used to branch internally on role between individual
// responses and department aggregates. That split is now two separate pages
// (PulseResponsesPage, PulseTrendsPage) so each role's nav names exactly the
// view it lands on; the two views above are exported for those pages to render
// directly. Nothing here decides access - each view's own data call is what a
// wrong role's auth token is denied on by firestore.rules.
