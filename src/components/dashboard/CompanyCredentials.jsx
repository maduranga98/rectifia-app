import { useState } from 'react'

// Shows the Company Admin's login credentials once, right after the company
// is registered. Invitation emails are not sent for now, so this screen is
// the handover: the password is generated server-side, returned in the
// createCompanyAdmin response, and never stored anywhere - once this screen
// is dismissed it cannot be shown again, only reset.
function CompanyCredentials({ companyName, email, password, onDone }) {
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
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Company registered</h2>
        <p className="mt-1 text-sm text-muted">
          {companyName ? `${companyName} is set up. ` : ''}
          Give these credentials to the Company Admin. They can sign in with
          them straight away and should change the password afterwards.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Login credentials
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted">Email</p>
              <p className="truncate font-mono text-sm text-charcoal">{email}</p>
            </div>
            <button
              type="button"
              onClick={() => copy('email', email)}
              className="btn-secondary shrink-0 rounded px-3 py-1.5 text-sm"
            >
              {copied === 'email' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted">Temporary password</p>
              <p className="truncate font-mono text-sm text-charcoal">
                {password}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copy('password', password)}
              className="btn-secondary shrink-0 rounded px-3 py-1.5 text-sm"
            >
              {copied === 'password' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => copy('both', `Email: ${email}\nPassword: ${password}`)}
          className="btn-secondary mt-4 rounded px-3 py-1.5 text-sm"
        >
          {copied === 'both' ? 'Copied both' : 'Copy both'}
        </button>
        {copyFailed && (
          <p className="mt-2 text-xs text-muted">
            Could not use the clipboard - copy the values above manually.
          </p>
        )}
      </div>

      <p className="text-sm text-critical">
        This password is shown only once and is not stored anywhere. Copy it
        before closing - if it is lost, the admin has to reset their password.
      </p>

      <button
        type="button"
        onClick={onDone}
        className="btn-primary rounded px-4 py-2"
      >
        Done
      </button>
    </div>
  )
}

export default CompanyCredentials
