import { useState } from 'react'
import { upgradeToConfidential } from '../../services/identityTransitionService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Input, Textarea } from '../ui/Field'

// Blueprint §7.2. The reporter who filed anonymously and has since decided the
// investigator should know who they are.
//
// Everything about how this is presented is load-bearing:
//
//   * It is collapsed. A permanently expanded form with the reporter's name
//     waiting to be typed is an invitation, and an invitation from the system
//     is only one step removed from an invitation from the investigator.
//   * It is offered only in the reporter's own view of their own case. There is
//     no staff-side counterpart anywhere in the app and no callable one could
//     be built on - an investigator who wants a name asks in the thread, in
//     their own words, where the asking is on the record.
//   * The trade-off is stated in full BEFORE the first input field, not beside
//     the submit button. Someone who has already typed their name has already
//     partly decided; the point at which the consequences matter is before that.
//   * It cannot be undone, and it says so rather than offering an undo. An
//     "undo" that left the details in the vault would be a lie, and one that
//     deleted them would destroy evidence in a live investigation. Neither is
//     a promise worth making, so the honest thing is to be clear up front.
//
// Rendered only while the case is anonymous and open - see CaseDetail.jsx.

// A checkbox is a click, and a click is easy to make without reading. Typing
// the phrase takes long enough to be a decision. It is deliberately short and
// unambiguous, in plain words rather than an ominous formula, because the
// friction is meant to be attention, not intimidation.
const CONFIRM_PHRASE = 'IDENTIFY ME'

const EMPTY_IDENTITY = { name: '', email: '', phone: '', jobTitle: '', notes: '' }

function IdentityUpgradePanel({ caseId, passcode, onUpgraded, className = '' }) {
  const [expanded, setExpanded] = useState(false)
  const [identity, setIdentity] = useState(EMPTY_IDENTITY)
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('idle') // idle | working | done | error
  const [error, setError] = useState(null)

  const set = (field) => (event) => setIdentity((prev) => ({ ...prev, [field]: event.target.value }))

  const hasDetail = Object.values(identity).some((value) => value.trim().length > 0)
  const confirmed = confirmation.trim().toUpperCase() === CONFIRM_PHRASE
  const canSubmit = hasDetail && confirmed && status !== 'working'

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canSubmit) return
    setStatus('working')
    setError(null)
    try {
      await upgradeToConfidential(caseId, passcode, identity)
      // Cleared immediately: the details belong in the vault, not in a React
      // state object sitting in a tab that may stay open for hours.
      setIdentity(EMPTY_IDENTITY)
      setConfirmation('')
      setStatus('done')
      onUpgraded?.()
    } catch (err) {
      setStatus('error')
      setError(err.message)
    }
  }

  const wrapper = `flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 ${className}`

  if (status === 'done') {
    return (
      <div className={wrapper}>
        <Alert variant="success" title="Your details are on the case">
          The handler assigned to your case can now find out who you are. Nobody else can, and
          nobody was told to ask you for this.
        </Alert>
      </div>
    )
  }

  if (!expanded) {
    return (
      <div className={wrapper}>
        <p className="flex items-center gap-2 text-sm font-medium text-charcoal">
          <Icon name="shield" className="h-4 w-4 text-muted" />
          Your report is anonymous
        </p>
        <p className="text-sm text-muted">
          Nobody working on this case knows who you are, and nothing here will ask you to change
          that. If you would rather the investigator could contact you directly, you can choose to
          tell them who you are.
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
        <Icon name="shield" className="h-4 w-4 text-muted" />
        Telling the investigator who you are
      </p>

      {/* Stated in full before a single field exists on screen. */}
      <div className="flex flex-col gap-2 rounded-lg border border-navy-200 bg-navy-50 p-3 text-sm text-charcoal">
        <p className="font-medium">What changes</p>
        <p>
          The handler assigned to your case will be able to see the details you give below. They
          have to give a written reason to see them, and every time anyone looks it is recorded.
        </p>

        <p className="mt-1 font-medium">What does not change</p>
        <ul className="list-disc pl-5">
          <li>The person your report is about never sees your name, or that you gave one.</li>
          <li>The HR Coordinator who oversees the case queue never sees it.</li>
          <li>Your Company Admin never sees it.</li>
          <li>
            Nothing you have already written in this case changes, and no message is sent to anyone
            asking about it.
          </li>
        </ul>

        <p className="mt-1 font-medium">This cannot be undone</p>
        <p>
          Once your details are stored they stay part of this case&apos;s record until it ends. We
          are not offering an undo button, because it could not mean what it says: removing your
          details from a live investigation would destroy part of its record, and leaving them in
          place while telling you they were gone would not be true.
        </p>
        <p>
          You are under no obligation to do this. Your case is worked the same way either way, and
          if you would rather stay anonymous, close this and carry on.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          Give as much or as little as you want — one detail is enough. Anything you leave blank is
          simply not stored.
        </p>

        <Input label="Your name" value={identity.name} onChange={set('name')} autoComplete="off" />
        <Input
          label="Email address"
          type="email"
          value={identity.email}
          onChange={set('email')}
          autoComplete="off"
          hint="For the investigator to reach you directly. This is separate from update notifications, which never contain case details."
        />
        <Input label="Phone" value={identity.phone} onChange={set('phone')} autoComplete="off" />
        <Input
          label="Job title"
          value={identity.jobTitle}
          onChange={set('jobTitle')}
          autoComplete="off"
        />
        <Textarea
          label="Anything else you want them to know"
          value={identity.notes}
          onChange={set('notes')}
          rows={2}
        />

        <Input
          label={`Type ${CONFIRM_PHRASE} to confirm`}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
          className="font-mono tracking-wide"
          hint="Typed out in full, so this is never something that happens on a stray click."
        />

        {status === 'error' && error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            loading={status === 'working'}
            loadingLabel="Saving"
          >
            Tell the investigator who I am
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setExpanded(false)
              setIdentity(EMPTY_IDENTITY)
              setConfirmation('')
              setStatus('idle')
              setError(null)
            }}
          >
            Stay anonymous
          </Button>
        </div>
      </form>
    </div>
  )
}

export default IdentityUpgradePanel
