import { useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { getAssignedCase } from '../../services/handlerService'
import {
  ActionForm,
  ConsistencyFlags,
  PolicyReferences,
  QuestionnaireAnswers,
  ReporterIdentityCard,
} from '../../components/investigation/CaseDetailView'
import ComplianceCountdown from '../../components/dashboard/ComplianceCountdown'
import CaseThread from '../../components/intake/CaseThread'
import CaseReport from '../../components/investigation/CaseReport'
import InvestigationChecklist from '../../components/investigation/InvestigationChecklist'
import RelatedPatternNotice from '../../components/investigation/RelatedPatternNotice'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { SkeletonList } from '../../components/ui/Loading'

const POLL_INTERVAL_MS = 8000

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

// Whether a deadline is still pending (set but not yet actioned) - what the
// Compliance tab flags as needing attention.
function hasPendingDeadline(caseData) {
  return Boolean(
    (caseData.acknowledgmentDueAt && !caseData.acknowledgmentSentAt) ||
      (caseData.feedbackDueAt && !caseData.feedbackGivenAt)
  )
}

// A consistency flag that has been raised but not yet acknowledged by the
// handler - the Consistency tab's attention marker.
function hasUnreviewedFlag(caseData) {
  const check = caseData.consistencyCheck
  return check?.status === 'flagged' && !check.flag?.reviewedAt
}

// The tabs, in order, and how each computes its attention badge from the case
// doc already polled below - so a handler sees what needs doing without opening
// every tab, and without any extra read. The Identity tab is confidential-tier
// only. `badge(caseData)` returns null, { dot: true }, or { count }.
const TABS = [
  { path: 'thread', label: 'Thread', badge: (c) => (c.unreadReporterCount ? { count: c.unreadReporterCount } : null) },
  { path: 'questionnaire', label: 'Questionnaire' },
  { path: 'checklist', label: 'Checklist' },
  { path: 'consistency', label: 'Consistency', badge: (c) => (hasUnreviewedFlag(c) ? { dot: true } : null) },
  { path: 'policy', label: 'Policy references' },
  { path: 'compliance', label: 'Compliance', badge: (c) => (hasPendingDeadline(c) ? { dot: true } : null) },
  { path: 'patterns', label: 'Patterns' },
  { path: 'identity', label: 'Identity', confidentialOnly: true },
  { path: 'action', label: 'Action & report' },
]

// A closed case has a compiled report. CaseReport is a self-contained,
// read-only view; the Action & report tab toggles between the action form and
// it, the same way the old stacked view did.
function ActionReportPanel({ caseData, caseId, onChanged }) {
  const [showReport, setShowReport] = useState(false)
  const closed = caseData.status === 'closed'

  if (closed && showReport) {
    return (
      <div className="flex flex-col gap-5">
        <Button variant="secondary" icon="back" className="self-start print:hidden" onClick={() => setShowReport(false)}>
          Back to case
        </Button>
        <CaseReport caseId={caseId} />
      </div>
    )
  }

  return (
    <Card
      title={closed ? 'Case outcome' : 'Take action'}
      description={closed ? undefined : 'Proposing an action starts the consistency check.'}
      actions={
        closed ? (
          <Button variant="primary" icon="document" onClick={() => setShowReport(true)}>
            View report
          </Button>
        ) : undefined
      }
    >
      <ActionForm caseData={caseData} onChanged={onChanged} />
    </Card>
  )
}

function TabBadge({ badge }) {
  if (!badge) return null
  if (badge.dot) {
    return <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-critical" aria-label="needs attention" />
  }
  return (
    <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-critical px-1.5 text-xs font-semibold text-white">
      {badge.count}
    </span>
  )
}

// A Case Handler's single-case workspace. The case moved to its own route
// (/dashboard/cases/:caseId) so it is refreshable, bookmarkable and shareable
// between handlers; inside it, each capability the old stacked scroll piled up
// is a tab reflected in the URL as a nested route. The case doc is polled here
// and passed to whichever tab needs it, so the tabs share one fetch. Fetching
// goes through getAssignedCase(), which firestore.rules only permits when this
// case is assigned to the signed-in handler.
function CaseWorkspacePage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const [caseData, setCaseData] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setCaseData(await getAssignedCase(caseId))
    } catch (err) {
      setError(err.message)
    }
  }, [caseId])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refresh])

  if (error) return <Alert variant="error">{error}</Alert>
  if (!caseData) return <SkeletonList rows={4} />

  const closed = caseData.status === 'closed'
  const confidential = caseData.tier === 'confidential'
  const visibleTabs = TABS.filter((t) => !t.confidentialOnly || confidential)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon="back" className="self-start" onClick={() => navigate('/dashboard/my-cases')}>
          Back to my cases
        </Button>
        <h2 className="text-xl font-semibold text-charcoal">Case {caseData.caseId ?? caseData.id}</h2>
        <Badge tone={closed ? 'tone-low' : 'tone-info'} dot>
          {humanize(caseData.status) ?? 'open'}
        </Badge>
        {caseData.priority === 'high' && (
          <Badge tone="tone-high" dot>
            High priority
          </Badge>
        )}
        {caseData.category && <span className="text-sm text-muted">{humanize(caseData.category)}</span>}
      </div>

      <div className="flex flex-wrap gap-1 overflow-x-auto border-b border-line" role="tablist">
        {visibleTabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `flex items-center whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-navy text-charcoal'
                  : 'border-transparent text-muted hover:text-charcoal'
              }`
            }
          >
            {tab.label}
            <TabBadge badge={tab.badge?.(caseData)} />
          </NavLink>
        ))}
      </div>

      <Routes>
        <Route index element={<Navigate to="thread" replace />} />
        <Route
          path="thread"
          element={
            <Card title="Case thread" description="Messages between the reporter and you.">
              <CaseThread caseId={caseId} mode="investigator" />
            </Card>
          }
        />
        <Route
          path="questionnaire"
          element={
            <Card title="Questionnaire answers">
              <QuestionnaireAnswers caseData={caseData} />
            </Card>
          }
        />
        <Route path="checklist" element={<InvestigationChecklist caseId={caseId} />} />
        <Route
          path="consistency"
          element={
            <Card title="Consistency check" padded={Boolean(caseData.consistencyCheck)}>
              <ConsistencyFlags caseData={caseData} />
            </Card>
          }
        />
        <Route path="policy" element={<PolicyReferences caseData={caseData} />} />
        <Route
          path="compliance"
          element={
            <Card title="Compliance deadlines">
              <ComplianceCountdown caseData={caseData} />
            </Card>
          }
        />
        <Route
          path="patterns"
          element={
            <Card
              title="Related patterns"
              description="Whether this case sits inside an active company-wide pattern signal."
            >
              <RelatedPatternNotice caseId={caseId} />
            </Card>
          }
        />
        <Route
          path="identity"
          element={
            confidential ? (
              <ReporterIdentityCard caseData={caseData} />
            ) : (
              <Navigate to="../thread" replace />
            )
          }
        />
        <Route path="action" element={<ActionReportPanel caseData={caseData} caseId={caseId} onChanged={refresh} />} />
        <Route path="*" element={<Navigate to="thread" replace />} />
      </Routes>
    </div>
  )
}

export default CaseWorkspacePage
