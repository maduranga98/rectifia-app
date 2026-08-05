import { useState } from 'react'
import { addContactEmail, removeContactEmail } from '../../services/identityTransitionService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Input } from '../ui/Field'

// Blueprint §8. The optional email address, offered passively in the
// reporter's own case view and nowhere else.
//
// The honest framing this component exists to deliver: adding an address does
// not change who can read what - staff cannot see it, in plaintext or
// ciphertext, and the case stays anonymous tier - but it does create a stored
// link between an address and this case where none existed before. That link
// is precisely the thing "fully anonymous" otherwise guarantees does not
// exist, and the reporter is told so in those words, before the field, rather
// than being reassured with the encryption and left to work out the rest.
//
// Two things follow from taking that seriously:
//   * We say outright that a throwaway address is a reasonable choice. Anyone
//     who would be harmed by the link existing should be told the cheapest way
//     to avoid it, not left to think of it themselves.
//   * The address can be removed, and removing it deletes it. That withdrawal
//     right is what makes offering the channel acceptable at all - unlike the
//     identity upgrade, an address is a delivery detail, not evidence, so
//     there is nothing that deleting it destroys.
//
// What arrives at the address is a deliberately vague notice - one of a
// rotating set of generic "you have an update" messages, with no case
// reference, no category, no status, and a link to the site's front page
// rather than to this case. The reporter still opens their case themselves
// with the Case ID and passcode they hold. There is no recovery flow built on
// this address and there never will be: an address that could recall a lost
// Case ID would quietly become a second credential.
function ContactChannelPanel({ caseId, passcode, hasContactEmail, onChanged, className = '' }) {
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | working | error
  const [error, setError] = useState(null)

  const wrapper = `flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 ${className}`

  async function handleAdd(event) {
    event.preventDefault()
    if (!email.trim() || status === 'working') return
    setStatus('working')
    setError(null)
    try {
      await addContactEmail(caseId, passcode, email)
      setEmail('')
      setExpanded(false)
      setStatus('idle')
      onChanged?.()
    } catch (err) {
      setStatus('error')
      setError(err.message)
    }
  }

  async function handleRemove() {
    setStatus('working')
    setError(null)
    try {
      await removeContactEmail(caseId, passcode)
      setStatus('idle')
      onChanged?.()
    } catch (err) {
      setStatus('error')
      setError(err.message)
    }
  }

  // Current state, with the way out beside it. The address itself is never
  // shown back - the server only ever tells this component that one exists,
  // and re-displaying it would mean shipping it to the browser for no reason
  // beyond decoration.
  if (hasContactEmail) {
    return (
      <div className={wrapper}>
        <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
          <Icon name="mail" className="h-4 w-4 text-muted" />
          An email address is saved for updates
        </p>
        <p className="text-sm text-muted">
          When there is an update on your case we send a short, deliberately vague message to that
          address — it never mentions your case, this company, or what you reported. You still open
          your case here with your Case ID and passcode.
        </p>
        <p className="text-xs text-muted">
          Removing it deletes the address completely. Notifications stop; nothing else about your
          case changes.
        </p>
        {status === 'error' && error && <Alert variant="error">{error}</Alert>}
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRemove}
            loading={status === 'working'}
            loadingLabel="Removing"
          >
            Remove this address
          </Button>
        </div>
      </div>
    )
  }

  if (!expanded) {
    return (
      <div className={wrapper}>
        <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
          <Icon name="mail" className="h-4 w-4 text-muted" />
          Want to be emailed when there is an update?
        </p>
        <p className="text-sm text-muted">
          Optional. Without it, you check back here whenever you like — nothing is lost by leaving
          this alone.
        </p>
        <div>
          <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
            Read what that would mean
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={wrapper}>
      <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
        <Icon name="mail" className="h-4 w-4 text-muted" />
        Adding an email address for updates
      </p>

      {/* The trade-off, before the field. */}
      <div className="flex flex-col gap-2 rounded-lg border border-navy-200 bg-navy-50 p-3 text-sm text-charcoal">
        <p className="font-medium">What this creates</p>
        <p>
          Saving an address creates a stored link between that address and this case. That link is
          exactly what &ldquo;anonymous&rdquo; otherwise guarantees does not exist. It is encrypted
          and nobody working on your case can read it — not your handler, not the HR Coordinator,
          not your Company Admin — but it exists, and you should decide knowing that rather than
          find out later.
        </p>

        <p className="mt-1 font-medium">A throwaway address is a fine choice</p>
        <p>
          A free burner address you make for this and nothing else works perfectly well here, and
          for many people it is the sensible option. We would rather say that plainly than have you
          use a work address because we stayed quiet about it.
        </p>

        <p className="mt-1 font-medium">What the emails say</p>
        <p>
          As little as possible, on purpose. Something like &ldquo;You have an update&rdquo; and a
          link to our front page — never your Case ID, the category, the status, or anything about
          this company. Anyone glancing at your inbox learns nothing.
        </p>

        <p className="mt-1 font-medium">You can take it back</p>
        <p>
          Remove it at any time from this page and the address is deleted, not just switched off.
        </p>
        <p>
          This does not change who can see your report or affect how your case is handled, and your
          case stays anonymous either way.
        </p>
      </div>

      <form onSubmit={handleAdd} className="flex flex-col gap-3">
        <Input
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          placeholder="you@example.com"
          hint="Keep hold of your Case ID and passcode either way — this address cannot be used to recover them."
        />

        {status === 'error' && error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!email.trim() || status === 'working'}
            loading={status === 'working'}
            loadingLabel="Saving"
          >
            Save this address
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setExpanded(false)
              setEmail('')
              setStatus('idle')
              setError(null)
            }}
          >
            No thanks
          </Button>
        </div>
      </form>
    </div>
  )
}

export default ContactChannelPanel
