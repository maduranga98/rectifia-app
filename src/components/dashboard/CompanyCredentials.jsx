import { useState } from 'react'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// One credential row: a label, the value in a mono face, and its own copy
// button. Split out so the email and the invite link are visibly the same
// kind of thing and the copy affordance sits in the same place on both.
function CredentialRow({ label, value, copied, onCopy }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.04em] text-muted">{label}</p>
        <p className="mt-0.5 truncate font-mono text-sm text-charcoal">{value}</p>
      </div>
      <Button size="sm" icon={copied ? 'check' : undefined} onClick={onCopy} className="shrink-0">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

// Shows the Company Admin's invite link once, right after the company is
// registered. The same link is emailed directly to the admin by
// createCompanyAdmin.js - clicking it lets them set their own password
// (AcceptInvitePage) - but this screen is still the backup handover in case
// that email fails to deliver. No password is ever generated or shown; the
// link itself is a Firebase password-reset action code and expires the same
// way one does.
function CompanyCredentials({ companyName, email, inviteLink, emailDelivered, onDone }) {
  const [copied, setCopied] = useState(null)
  const [copyFailed, setCopyFailed] = useState(false)

  async function copy(label, value) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyFailed(false)
      setCopied(label)
    } catch {
      // Clipboard access can be blocked (insecure origin, permission) - the
      // values are on screen in full, so say so instead of failing silently.
      setCopied(null)
      setCopyFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-low/10 text-low">
          <Icon name="check" className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-charcoal">Company registered</h2>
          <p className="mt-1 text-sm text-muted">
            {companyName ? `${companyName} is set up. ` : ''}
            {emailDelivered
              ? 'A link to set their password was also emailed directly to the admin. '
              : ''}
            Give this link to the Company Admin if the email doesn&rsquo;t arrive - opening it lets
            them set their own password and sign in.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <CredentialRow
          label="Email"
          value={email}
          copied={copied === 'email'}
          onCopy={() => copy('email', email)}
        />
        <CredentialRow
          label="Set-password link"
          value={inviteLink}
          copied={copied === 'link'}
          onCopy={() => copy('link', inviteLink)}
        />
        {copyFailed && (
          <p className="text-xs text-muted">
            Could not use the clipboard - copy the values above manually.
          </p>
        )}
      </div>

      <Alert variant="warning" title="Shown once">
        This link is not stored anywhere and expires after use. If it&rsquo;s lost, the admin can
        request a new one from the sign-in page&rsquo;s &ldquo;Forgot password&rdquo; link.
      </Alert>

      {emailDelivered === false && (
        <Alert variant="error" title="Email delivery failed">
          The invite email to {email} could not be sent. Hand this link over directly instead.
        </Alert>
      )}

      <Button variant="primary" onClick={onDone} className="self-start">
        Done
      </Button>
    </div>
  )
}

export default CompanyCredentials
