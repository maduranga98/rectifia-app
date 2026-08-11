import { useEffect, useState } from 'react'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { downloadSimplePdf, RECTIFIA_BRAND_COLOR } from '../../utils/simplePdf'
import { sendReporterMessage, uploadCaseEvidence } from '../../services/caseThreadService'

// Uploads each file staged during the questionnaire (see
// QuestionnaireForm.jsx's file-staging step) now that a caseId and passcode
// finally exist, and - for whichever files succeed - posts them as one
// reporter message so they land in the case thread exactly the way an
// attachment sent later from CaseThread.jsx would. Shared by this component
// (staff-on-behalf intake) and Submit.jsx (the reporter's own intake): both
// screens exist to hand over a caseId + passcode safely, and this is what
// happens the instant that pair exists, so the upload belongs in one place
// rather than two copies that could drift on error handling.
//
// Never throws. A failed upload here must never cost the reporter their Case
// ID and passcode - the one thing either screen exists to show safely - so
// every outcome, success or failure, is returned per file instead, for the
// caller to display once the credentials are already on screen.
export async function uploadStagedEvidence(caseId, passcode, files) {
  if (!files || files.length === 0) return []

  const results = []
  const attachments = []
  for (const file of files) {
    try {
      const attachment = await uploadCaseEvidence(caseId, file, passcode)
      attachments.push(attachment)
      results.push({ label: file.name, status: 'success' })
    } catch (err) {
      results.push({ label: file.name, status: 'failed', error: err.message })
    }
  }

  if (attachments.length > 0) {
    try {
      await sendReporterMessage(caseId, passcode, 'Files attached when this report was filed.', attachments)
    } catch {
      // Uploaded to storage but never reached the thread, so nothing shows
      // them yet - "uploaded but not attached to anything" is not success
      // from the reporter's side, and the failure messaging below tells them
      // to retry from the thread either way.
      for (const result of results) {
        if (result.status === 'success') {
          result.status = 'failed'
          result.error = 'Could not attach to your case thread'
        }
      }
    }
  }

  return results
}

// The staged-evidence upload outcome, once uploading has settled. Renders
// nothing while nothing has been staged - most cases file with no evidence
// at all, and this must not add a permanent empty card to that path.
export function StagedEvidenceStatus({ uploading, results }) {
  if (!uploading && results.length === 0) return null

  const failed = results.filter((result) => result.status === 'failed')

  return (
    <Card title="Files you attached">
      {uploading ? (
        <p className="text-sm text-muted">Attaching your files…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-1.5 text-sm">
            {results.map((result) => (
              <li key={result.label} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-charcoal">{result.label}</span>
                <span className={result.status === 'success' ? 'text-low' : 'text-critical'}>
                  {result.status === 'success' ? 'Attached' : 'Failed'}
                </span>
              </li>
            ))}
          </ul>
          {failed.length > 0 && (
            <Alert variant="warning">
              {failed.length} file{failed.length === 1 ? '' : 's'} could not be attached. Your
              report was filed successfully regardless - once you have your Case ID and
              passcode, you can attach these files from your case thread instead.
            </Alert>
          )}
        </div>
      )}
    </Card>
  )
}

// The one and only time a staff-filed case's credentials are visible.
//
// The passcode is stored as a scrypt hash and the case has no account to
// prove identity against, so there is no reset, no resend, and no support
// path - if this screen is closed before the reporter has the details, that
// reporter has permanently lost access to the case they filed. The whole
// component is built around making that impossible to do by accident: the
// warning is above the credentials rather than below them, the copy action
// hands over everything at once, and the "done" button says what it costs.
//
// Losing this matters more here than on the reporter's own screen. There the
// person who loses access is the one who was looking at it; here the staff
// member closing the tab is not the person who suffers for it.
//
// stagedFiles is optional and empty by default - StaffIntakeForm.jsx does
// not currently offer the questionnaire's staging step, so this is a no-op
// for it today. When it is empty, nothing below behaves any differently
// than before this prop existed.
function CaseCredentialsHandoff({
  caseId,
  passcode,
  tier,
  backdateWarning,
  stagedFiles = [],
  onDone,
  onFileAnother,
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [evidenceUploading, setEvidenceUploading] = useState(stagedFiles.length > 0)
  const [evidenceResults, setEvidenceResults] = useState([])

  useEffect(() => {
    if (stagedFiles.length === 0) return
    let cancelled = false
    uploadStagedEvidence(caseId, passcode, stagedFiles).then((results) => {
      if (!cancelled) {
        setEvidenceResults(results)
        setEvidenceUploading(false)
      }
    })
    return () => {
      cancelled = true
    }
    // Intentionally run once, on mount - this screen exists for exactly one
    // caseId/passcode/stagedFiles combination for its whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const trackingUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/case/${caseId}` : null

  // One block, not three fields - the staff member is about to read this out
  // or paste it into a message, and a copy button per field invites handing
  // over two of the three.
  const handoverText = [
    `Case ID: ${caseId}`,
    `Passcode: ${passcode}`,
    trackingUrl ? `Track it here: ${trackingUrl}` : null,
    '',
    'Keep these somewhere private. They cannot be reissued - without them there is no way back into the case.',
  ]
    .filter(Boolean)
    .join('\n')

  async function copyAll() {
    setCopied(false)
    setCopyFailed(false)
    try {
      // Absent over plain http and in some locked-down corporate browsers,
      // which is a realistic place for an HR desktop to be. The text stays
      // selectable on screen either way.
      await navigator.clipboard.writeText(handoverText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }

  // Deliberately just the three values, one per line - nothing here should
  // name Rectifia, the employer, or the report category, since this file is
  // as likely to land in a company-managed Downloads folder as anywhere
  // private. The filename carries the same restriction: no "case", "report",
  // "rectifia", or company name, since a filename is readable by anything
  // that indexes a Downloads folder without ever opening the file.
  function downloadDetails() {
    const text = [caseId, passcode, trackingUrl].filter(Boolean).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'personal-notes.txt'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Same values, same privacy constraints as downloadDetails() above, but as
  // a PDF the reporter can hand off or keep in a way that reads as a saved
  // document rather than a stray text file - it's what makes it easy to come
  // back and check progress later.
  function downloadPdf() {
    downloadSimplePdf(
      [
        // Rectifia's own wordmark, not the reporting company's - see the
        // comment above downloadDetails() for why this document stays
        // free of anything naming the employer.
        { text: 'RECTIFIA', bold: true, color: RECTIFIA_BRAND_COLOR },
        { rule: true, color: RECTIFIA_BRAND_COLOR },
        '',
        { text: 'Case tracking details', bold: true },
        '',
        `Case ID: ${caseId}`,
        `Passcode: ${passcode}`,
        trackingUrl ? `Track it here: ${trackingUrl}` : null,
        '',
        'Keep these somewhere private. They cannot be reissued - without them',
        'there is no way back into the case.',
      ].filter((line) => line !== null),
      'personal-notes.pdf'
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="success" title="Case filed">
        The report is now in the system and has been routed like any other case. The reporter
        has the same access to it as if they had filed it themselves — but only if you pass on
        the details below.
      </Alert>

      {backdateWarning && (
        <Alert variant="warning" title="This report was received some time ago">
          Its compliance deadlines were calculated from the date you entered, not from today, so
          one or both may already have passed. That is the correct reading of the case — check
          the handler dashboard for what is now outstanding.
        </Alert>
      )}

      {/* Above the credentials, not below: by the time someone scrolls past a
          passcode they have already decided what to do with it. */}
      <Alert variant="warning" title="Shown once — these cannot be recovered">
        The passcode is stored only as a hash. Nobody can look it up, reset it, or send it on:
        not you, not a Company Admin, not Rectifia.{' '}
        <strong className="font-semibold">
          If you leave this screen without giving the reporter these details, they permanently
          lose access to their own case
        </strong>{' '}
        — they will not be able to read replies, answer the investigator&apos;s questions, or
        add anything they remember later.
      </Alert>

      <Card title="Give these to the reporter">
        <dl className="flex flex-col gap-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Case ID</dt>
            <dd className="mt-1 select-all font-mono text-lg font-semibold text-charcoal">
              {caseId}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Passcode</dt>
            <dd className="mt-1 select-all font-mono text-lg font-semibold text-charcoal">
              {passcode}
            </dd>
          </div>
          {trackingUrl && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Where they check on it</dt>
              <dd className="mt-1">
                {/* Spelled out rather than hidden behind a link label - this
                    gets read down a phone line or written on paper as often
                    as it gets clicked. */}
                <code className="block select-all break-all rounded-md border border-line bg-line-soft px-3 py-2 text-xs text-charcoal">
                  {trackingUrl}
                </code>
                <p className="mt-1.5 text-xs text-muted">
                  The link fills in the Case ID. It does not contain the passcode, so on its own
                  it opens nothing.
                </p>
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button icon="document" variant="primary" className="min-h-11" onClick={copyAll}>
            {copied ? 'Copied' : 'Copy all details'}
          </Button>
          <Button icon="document" className="min-h-11" onClick={downloadDetails}>
            Download to this device
          </Button>
          <Button icon="document" className="min-h-11" onClick={downloadPdf}>
            Download as PDF
          </Button>
          {copyFailed && (
            <span className="text-xs text-muted">
              Couldn&apos;t copy automatically — select the details above and copy them.
            </span>
          )}
        </div>
        {/* The tradeoff has to be legible before the click, not discovered
            after - so it sits directly under the button that causes it, not
            buried in the warning card below. */}
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Saves a plain-text file to this device&apos;s usual downloads location. On a
          company-managed device, that file can be visible to IT, endpoint monitoring, or backup
          tools — including your employer&apos;s, if that&apos;s who this report is about.
        </p>
      </Card>

      <StagedEvidenceStatus uploading={evidenceUploading} results={evidenceResults} />

      <Card title="Before you close this">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Hand the Case ID and passcode to the reporter now, by whatever route they asked you
            to use.
          </li>
          <li>
            Don&apos;t keep a copy in your own notes, inbox, or a shared drive — a passcode
            sitting in a mailbox is a way into someone&apos;s case that outlives this
            conversation. If you use the download option above to hand these off, delete that
            file the same way once the reporter has the details, not just from your notes.
          </li>
          {tier === 'confidential' && (
            <li>
              Their identity is encrypted and stored. It is not visible on any dashboard or in
              any case report, and reading it requires a Super Admin and a documented reason.
            </li>
          )}
          <li>
            The reporter can reply to the investigator and add information at any time using
            these details.
          </li>
        </ul>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface p-3 text-sm">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-charcoal">
            I have given the Case ID and passcode to the reporter.
          </span>
        </label>

        {/* Gated on the checkbox rather than just warned about. It is one
            deliberate click, and it is the difference between "I read the
            warning" and "I did the thing". */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={!acknowledged} onClick={onDone}>
            Done
          </Button>
          {onFileAnother && (
            <Button icon="plus" disabled={!acknowledged} onClick={onFileAnother}>
              File another report
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

export default CaseCredentialsHandoff
