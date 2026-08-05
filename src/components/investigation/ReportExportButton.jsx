import { useEffect, useState } from 'react'
import { auth } from '../../services/firebase'
import { exportReportPdf, listReportExports } from '../../services/reportService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { Textarea } from '../ui/Field'

function formatTimestamp(value) {
  const ms = typeof value?.toMillis === 'function' ? value.toMillis() : value
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

function formatBytes(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// A signed URL is meant to be followed immediately, not stored - the same
// reasoning EvidenceRow in CaseReport.jsx already applies to evidence
// downloads. Opening it via a throwaway anchor click means the URL string
// never lands in component state, a log, or anywhere else it could outlive
// its own 15-minute expiry.
function openSignedUrl(url) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noreferrer'
  anchor.click()
}

const MIN_REASON_LENGTH = 10

// Replaces CaseReport.jsx's old window.print() button with a real,
// server-rendered PDF - functions/src/reports/exportReportPdf.js does the
// actual work (compile, render, hash, upload, sign, audit); this component
// only triggers it, shows progress, opens the resulting signed URL, and
// lists the case's export history so an investigator can see who pulled a
// copy of this report and when - "this report left the system three times
// last month" should be answerable from the screen, not a support ticket.
//
// `hasRestrictedIdentity` mirrors CaseReport.jsx's own gate: true only for a
// confidential-tier case with an identity on file
// (report.restrictedReporterIdentity). `canIncludeIdentity` is this viewer's
// own authorization to see that identity at all, exactly like
// CaseReport.jsx's canViewReporterIdentity prop. Both only decide whether
// this component OFFERS the "include identity" option - the server
// independently re-derives tier, purge state, and authorization from
// scratch and will refuse or omit it regardless of what this component
// sends, so neither prop is a security boundary on its own.
function ReportExportButton({ caseId, hasRestrictedIdentity = false, canIncludeIdentity = false }) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState(null)
  const [showIdentityPanel, setShowIdentityPanel] = useState(false)
  const [includeIdentity, setIncludeIdentity] = useState(false)
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const rows = await listReportExports(caseId)
      setHistory(rows)
    } catch {
      // The history list is a convenience view, not the export path itself -
      // a failed read here should never block generating a new copy.
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  async function runExport() {
    setExporting(true)
    setError(null)
    try {
      const options = includeIdentity ? { includeIdentity: true, reason } : {}
      const result = await exportReportPdf(caseId, options)
      openSignedUrl(result.downloadUrl)
      setShowIdentityPanel(false)
      setIncludeIdentity(false)
      setReason('')
      await loadHistory()
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  function handlePrimaryClick() {
    // A case with an identity worth asking about gets an intermediate panel
    // first click; a case without one exports immediately - most exports
    // never touch identity at all, and this keeps the common path a single
    // click.
    if (hasRestrictedIdentity && canIncludeIdentity && !showIdentityPanel) {
      setShowIdentityPanel(true)
      return
    }
    runExport()
  }

  const currentUid = auth.currentUser?.uid
  const reasonTooShort = includeIdentity && reason.trim().length < MIN_REASON_LENGTH

  return (
    <div className="flex flex-col gap-4 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon="document"
          onClick={handlePrimaryClick}
          loading={exporting}
          loadingLabel="Generating PDF…"
        >
          Export as PDF
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {showIdentityPanel && (
        <Card
          title="Include reporter identity?"
          description="Confidential tier only. Decrypts and prints the reporter's identity in the PDF's appendix, and is logged the same as any other identity access."
        >
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2.5 text-sm text-charcoal">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={includeIdentity}
                onChange={(event) => setIncludeIdentity(event.target.checked)}
              />
              Include reporter identity in this export
            </label>

            {includeIdentity && (
              <Textarea
                label="Reason"
                hint={`Documented legal reason, at least ${MIN_REASON_LENGTH} characters. Recorded in the identity access audit log.`}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                icon="document"
                onClick={runExport}
                loading={exporting}
                loadingLabel="Generating PDF…"
                disabled={reasonTooShort}
              >
                Generate PDF
              </Button>
              <Button variant="ghost" onClick={() => setShowIdentityPanel(false)} disabled={exporting}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card title="Export history" description="Every time this case's report has been rendered to PDF.">
        {historyLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">This report has not been exported yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-charcoal">
                    {entry.exportedByUid === currentUid ? 'You' : entry.exportedByUid}
                  </span>
                  <span className="text-xs text-muted">{formatTimestamp(entry.exportedAt)}</span>
                  {entry.includedIdentity && <Badge tone="tone-high">Identity included</Badge>}
                </div>
                <span className="text-xs text-muted">
                  {entry.pageCount ?? '—'} pages · {formatBytes(entry.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export default ReportExportButton
