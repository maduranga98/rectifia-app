import { useState } from 'react'
import { resendCompanyAdminInvite } from '../../services/companyService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'

// Super Admin's re-send tool for the Company Admin's set-your-password link.
//
// The link handed over when the company is registered (CompanyCredentials) is
// a Firebase password-reset action code, so it expires - and CompanyCredentials
// shows it exactly once. Before this panel existed, an admin who clicked too
// late left the Super Admin with nothing to hand over but a password, which is
// precisely what the link-based flow exists to avoid. Nothing here ever shows
// or generates a password: it mints a fresh link, emails it to the admin, and
// shows the same link as the backup handover.
function CompanyAdminInvite({ company, onSent }) {
  const [result, setResult] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  async function handleResend() {
    setError(null)
    setSending(true)
    try {
      const response = await resendCompanyAdminInvite({ companyId: company.id })
      setResult(response)
      setCopied(false)
      await onSent?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.inviteLink)
      setCopied(true)
    } catch {
      // Clipboard access can be blocked (insecure origin, permission) - the
      // link is on screen in full, so this just stops claiming it was copied.
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Sends the Company Admin a fresh link to set their own password. Use this when the original
        invite expired or never arrived - there is no password to hand over, and the admin can also
        get a link themselves from the sign-in page&rsquo;s &ldquo;Forgot password&rdquo;.
      </p>

      <Button
        variant="secondary"
        icon="mail"
        loading={sending}
        loadingLabel="Sending"
        onClick={handleResend}
        className="self-start"
      >
        Resend set-password link
      </Button>

      {error && <Alert variant="error">{error}</Alert>}

      {result && (
        <div className="flex flex-col gap-2.5">
          <Alert
            variant={result.emailDelivered ? 'success' : 'warning'}
            title={result.emailDelivered ? 'Link sent' : 'Email delivery failed'}
          >
            {result.emailDelivered
              ? `A new set-password link was emailed to ${result.email}.`
              : `The email to ${result.email} could not be sent - hand the link below over directly.`}
          </Alert>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.04em] text-muted">
                Set-password link
              </p>
              <p className="mt-0.5 truncate font-mono text-sm text-charcoal">{result.inviteLink}</p>
            </div>
            <Button size="sm" icon={copied ? 'check' : undefined} onClick={copyLink} className="shrink-0">
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-muted">
            <Icon name="clock" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            This link expires and can only be used once. Resend again if it goes stale.
          </p>
        </div>
      )}
    </div>
  )
}

export default CompanyAdminInvite
