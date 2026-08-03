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
      className="print:hidden rounded bg-blue-600 px-4 py-2 text-sm text-white"
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

  if (loading) return <p className="p-6 text-sm text-gray-500">Loading report...</p>
  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>
  if (!report) return null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 print:p-0">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Case report - {report.caseId}</h1>
        <ExportPdfButton />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-gray-700">Case summary</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Category</dt>
          <dd>{report.summary.category ?? '-'}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd>{report.summary.status ?? '-'}</dd>
          <dt className="text-gray-500">Created</dt>
          <dd>{formatTimestamp(report.summary.createdAt)}</dd>
          <dt className="text-gray-500">Closed</dt>
          <dd>{formatTimestamp(report.summary.closedAt)}</dd>
          <dt className="text-gray-500">Severity score</dt>
          <dd>{report.summary.severityScore ?? '-'}</dd>
          <dt className="text-gray-500">Evidence score</dt>
          <dd>{report.summary.evidenceScore ?? '-'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700">Message timeline</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {report.timeline.length === 0 && <li className="text-sm text-gray-500">No messages.</li>}
          {report.timeline.map((message) => (
            <li key={message.id} className="rounded border border-gray-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="font-medium">{messageAuthorLabel(message)}</span>
                <span>{formatTimestamp(message.timestamp)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{message.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700">Evidence</h2>
        {report.evidence.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No attachments.</p>
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
        <h2 className="text-sm font-semibold text-gray-700">Investigator manual log</h2>
        {report.manualLogEntries.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No manual log entries.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {report.manualLogEntries.map((entry) => (
              <li key={entry.id} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <div className="text-xs text-gray-500">{formatTimestamp(entry.timestamp)}</div>
                <p className="mt-1 whitespace-pre-wrap">{entry.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700">Consistency check</h2>
        {!report.consistencyCheck ? (
          <p className="mt-2 text-sm text-gray-500">No consistency check has run for this case.</p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-500">Status</dt>
            <dd>{report.consistencyCheck.status ?? '-'}</dd>
            <dt className="text-gray-500">Flag</dt>
            <dd>{report.consistencyCheck.flag?.message ?? 'None'}</dd>
            <dt className="text-gray-500">Typical action</dt>
            <dd>{report.consistencyCheck.typicalAction ?? '-'}</dd>
            <dt className="text-gray-500">Resolution notes</dt>
            <dd>{report.consistencyCheck.resolutionNotes ?? '-'}</dd>
          </dl>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700">Final action taken</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Action</dt>
          <dd>{report.finalAction.actionTaken ?? report.finalAction.proposedAction ?? 'Not yet decided'}</dd>
          <dt className="text-gray-500">Effective date</dt>
          <dd>{formatTimestamp(report.finalAction.actionEffectiveDate)}</dd>
          <dt className="text-gray-500">Notes</dt>
          <dd>{report.finalAction.actionNotes ?? '-'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-700">Compliance deadline log</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Rule applied</dt>
          <dd>{report.complianceDeadlineLog.complianceRuleApplied ?? '-'}</dd>
          <dt className="text-gray-500">Acknowledgment due</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.acknowledgmentDueAt)}</dd>
          <dt className="text-gray-500">Acknowledgment sent</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.acknowledgmentSentAt)}</dd>
          <dt className="text-gray-500">Feedback due</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.feedbackDueAt)}</dd>
          <dt className="text-gray-500">Feedback given</dt>
          <dd>{formatTimestamp(report.complianceDeadlineLog.feedbackGivenAt)}</dd>
        </dl>
      </section>

      {report.restrictedReporterIdentity && (
        <section className="rounded border-2 border-red-300 bg-red-50 p-4">
          <h2 className="text-sm font-semibold text-red-700">Restricted - reporter identity (confidential tier)</h2>
          <p className="mt-1 text-xs text-red-600">
            Visible only to roles authorized to see reporter identity on confidential-tier cases.
          </p>
          {canViewReporterIdentity ? (
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {Object.entries(report.restrictedReporterIdentity).map(([key, value]) => (
                <Fragment key={key}>
                  <dt className="text-gray-500">{key}</dt>
                  <dd>{String(value)}</dd>
                </Fragment>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-red-700">
              You are not authorized to view reporter identity for this case.
            </p>
          )}
        </section>
      )}
    </div>
  )
}

export default CaseReport
