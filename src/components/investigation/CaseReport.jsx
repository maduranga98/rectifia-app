import { Fragment, useEffect, useState } from 'react'
import { generateReport } from '../../services/reportService'

function formatTimestamp(ms) {
  if (!ms) return '-'
  return new Date(ms).toLocaleString()
}

function messageAuthorLabel(message) {
  if (message.type === 'manual_log') return 'Investigator log'
  if (message.sender === 'system') return 'System'
  if (message.sender === 'ai') return 'AI assistant'
  if (message.sender === 'investigator') return 'Case Handler'
  return 'Reporter'
}

// No PDF/document-generation library exists anywhere else in this codebase
// (no jsPDF, pdfmake, or puppeteer), so this uses the browser's native
// print-to-PDF: a print stylesheet hides everything except the report body,
// and "Export as PDF" just triggers window.print(), where "Save as PDF" is
// a print destination in every major browser. No new dependency required.
function ExportPdfButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden btn-primary rounded px-4 py-2 text-sm"
    >
      Export as PDF
    </button>
  )
}

// Renders the final case report compiled by
// functions/src/intake/generateReport.js - a read-only compile, so opening
// this view never changes case data.
//
// canViewReporterIdentity gates the restricted reporter-identity section
// (confidential-tier cases only) on top of what the backend already omits
// for anonymous-tier cases. There is no real role-based access control in
// this codebase yet (see the TODOs in caseThread.js / routeCase.js on staff
// auth) - the caller of this component is responsible for only passing
// canViewReporterIdentity=true for a viewer actually authorized to see it.
function CaseReport({ caseId, canViewReporterIdentity = false }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    generateReport(caseId)
      .then((result) => {
        if (!cancelled) setReport(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [caseId])

  if (loading) return <p className="p-6 text-sm text-muted">Loading report...</p>
  if (error) return <p className="p-6 text-sm text-critical">{error}</p>
  if (!report) return null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 print:p-0">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Case report - {report.caseId}</h1>
        <ExportPdfButton />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-charcoal">Case summary</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Category</dt>
          <dd>{report.summary.category ?? '-'}</dd>
          <dt className="text-muted">Status</dt>
          <dd>{report.summary.status ?? '-'}</dd>
          <dt className="text-muted">Created</dt>
          <dd>{formatTimestamp(report.summary.createdAt)}</dd>
          <dt className="text-muted">Closed</dt>
          <dd>{formatTimestamp(report.summary.closedAt)}</dd>
          <dt className="text-muted">Severity score</dt>
          <dd>{report.summary.severityScore ?? '-'}</dd>
          <dt className="text-muted">Evidence score</dt>
          <dd>{report.summary.evidenceScore ?? '-'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-charcoal">Message timeline</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {report.timeline.length === 0 && <li className="text-sm text-muted">No messages.</li>}
          {report.timeline.map((message) => (
            <li key={message.id} className="border border-line bg-surface rounded px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-xs text-muted">
                <span className="font-medium">{messageAuthorLabel(message)}</span>
                <span>{formatTimestamp(message.timestamp)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{message.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-charcoal">Evidence</h2>
        {report.evidence.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No attachments.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {report.evidence.map((item) => (
              <li key={item.path}>
                {item.filename} - submitted by {item.postedBy} on {formatTimestamp(item.postedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-charcoal">Investigator manual log</h2>
        {report.manualLogEntries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No manual log entries.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {report.manualLogEntries.map((entry) => (
              <li key={entry.id} className="rounded border border tone-high px-3 py-2 text-sm">
                <div className="text-xs text-muted">{formatTimestamp(entry.timestamp)}</div>
                <p className="mt-1 whitespace-pre-wrap">{entry.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-charcoal">Consistency check</h2>
        {!report.consistencyCheck ? (
          <p className="mt-2 text-sm text-muted">No consistency check has run for this case.</p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>{report.consistencyCheck.status ?? '-'}</dd>
            <dt className="text-muted">Flag</dt>
            <dd>{report.consistencyCheck.flag?.message ?? 'None'}</dd>
            <dt className="text-muted">Typical action</dt>
            <dd>{report.consistencyCheck.typicalAction ?? '-'}</dd>
            <dt className="text-muted">Resolution notes</dt>
            <dd>{report.consistencyCheck.resolutionNotes ?? '-'}</dd>
          </dl>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-charcoal">Final action taken</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Action</dt>
          <dd>{report.finalAction.actionTaken ?? report.finalAction.proposedAction ?? 'Not yet decided'}</dd>
          <dt className="text-muted">Effective date</dt>
          <dd>{formatTimestamp(report.finalAction.actionEffectiveDate)}</dd>
          <dt className="text-muted">Notes</dt>
          <dd>{report.finalAction.actionNotes ?? '-'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-charcoal">Compliance deadline log</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Rule applied</dt>
          <dd>{report.complianceDeadlineLog.complianceRuleApplied ?? '-'}</dd>
          <dt className="text-muted">Acknowledgment due</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.acknowledgmentDueAt)}</dd>
          <dt className="text-muted">Acknowledgment sent</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.acknowledgmentSentAt)}</dd>
          <dt className="text-muted">Feedback due</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.feedbackDueAt)}</dd>
          <dt className="text-muted">Feedback given</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.feedbackGivenAt)}</dd>
        </dl>
      </section>

      {report.restrictedReporterIdentity && (
        <section className="rounded border-2 tone-critical p-4">
          <h2 className="text-sm font-semibold text-critical">Restricted - reporter identity (confidential tier)</h2>
          <p className="mt-1 text-xs text-critical">
            Visible only to roles authorized to see reporter identity on confidential-tier cases.
          </p>
          {canViewReporterIdentity ? (
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {Object.entries(report.restrictedReporterIdentity).map(([key, value]) => (
                <Fragment key={key}>
                  <dt className="text-muted">{key}</dt>
                  <dd>{String(value)}</dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-critical">
              You are not authorized to view reporter identity for this case.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

export default CaseReport
