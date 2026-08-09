import { useState } from 'react'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { downloadSimplePdf } from '../../utils/simplePdf'

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
function CaseCredentialsHandoff({ caseId, passcode, tier, backdateWarning, onDone, onFileAnother }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

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
