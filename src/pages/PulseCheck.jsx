import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import PulseSurveyForm from '../components/pulse-check/PulseSurveyForm'
import { validatePulseInvite } from '../services/pulseCheckService'
import Card from '../components/ui/Card'
import EmptyState from '../components/ui/EmptyState'

// The employee's whole path into a pulse check: /pulse/:inviteId?t=<token>.
// The inviteId is in the path and the single-use token in the ?t= query param
// (exactly what deliverNotifications' pulseCheckInvite email builds). This
// route is deliberately NOT behind ProtectedRoute - a roster employee has no
// account, and the token is their only credential.
//
// companyId, department and employeeId are never read from the URL: the only
// thing the client sends the server is inviteId + token, and the server reads
// everything else off the invite document. That is why the URL carries neither.

// Distinct, plain-language copy per validation outcome. 'used' is intentionally
// reassuring rather than an error: an employee who clicks their link twice must
// be told their earlier response was recorded, not left thinking it failed.
const INVALID_STATES = {
  used: {
    icon: 'check',
    title: 'Your response has already been recorded',
    description:
      "This check-in was already completed - there is nothing more to do. Thank you; your earlier response was saved.",
  },
  expired: {
    icon: 'clock',
    title: 'This check-in link has expired',
    description:
      'Pulse-check links are open only for a limited time. A new one will arrive with the next check-in - no action is needed from you now.',
  },
  invalid: {
    icon: 'alert',
    title: "This check-in link isn't valid",
    description:
      "The link may be incomplete or mistyped. Please open the most recent link from your invitation email exactly as it was sent.",
  },
  // Deliberately does NOT tell the employee to re-open the link from their
  // email: that is the one action guaranteed to fail while this invite is over
  // its attempt budget, and sending them round that loop is what made the old
  // shared 'invalid' copy actively misleading here.
  rate_limited: {
    icon: 'alert',
    title: 'Too many attempts on this link',
    description:
      'This check-in link has been opened too many times and is no longer accepting attempts. A new link will arrive with your next check-in - no action is needed from you now.',
  },
  // Ours, not theirs, and probably transient - so it must not read as a dead
  // link. Never carries the underlying code; that goes to the console only.
  error: {
    icon: 'alert',
    title: "We couldn't open your check-in",
    description:
      'Something went wrong on our side while loading this check-in. Please try again in a few minutes - your link is fine.',
  },
}

// Maps a callable failure onto one of the INVALID_STATES keys. Firebase's
// callable client reports its status as either 'resource-exhausted' or
// 'functions/resource-exhausted' depending on how the error surfaces, so the
// prefix is stripped before matching.
function statusForError(err) {
  const code = String(err?.code ?? '').replace(/^functions\//, '')
  if (code === 'resource-exhausted') return 'rate_limited'
  if (code === 'unavailable' || code === 'internal') return 'error'
  // A request that never reached the function at all (offline, DNS, CORS,
  // blocked request) is our problem to retry, not a bad link.
  if (code === 'deadline-exceeded' || err instanceof TypeError) return 'error'
  return 'invalid'
}

function PulseCheck() {
  const { inviteId } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')

  // status: 'loading' | 'valid' | 'used' | 'expired' | 'invalid'
  //         | 'rate_limited' | 'error'
  const [status, setStatus] = useState('loading')
  const [invite, setInvite] = useState(null)
  // The questionnaire this invite was minted with, resolved server-side and
  // returned by the same validate call - one round trip, not two, and it is the
  // set this specific link was sent with rather than whatever is published now.
  const [questionSet, setQuestionSet] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!inviteId || !token) {
        if (!cancelled) setStatus('invalid')
        return
      }
      try {
        const result = await validatePulseInvite({ inviteId, token })
        if (cancelled) return
        if (result.valid) {
          setInvite(result.invite)
          setQuestionSet(result.questionSet ?? null)
          setStatus('valid')
        } else {
          // Coarse reason from the server; anything unrecognised is treated as
          // an invalid link rather than guessed at.
          setStatus(INVALID_STATES[result.reason] ? result.reason : 'invalid')
        }
      } catch (err) {
        // A bare catch here made this the single hardest failure in the app to
        // diagnose: an employee reports a dead link and there is nothing in a
        // production browser session to say whether it was rate limiting, a
        // cold function, or an offline device. The code goes to the console;
        // the UI still only ever shows the plain-language copy above.
        console.error('validatePulseInvite failed', { code: err?.code })
        if (!cancelled) setStatus(statusForError(err))
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [inviteId, token])

  if (status === 'loading') {
    return (
      <ReporterLayout title="Wellness check-in">
        <Card padded={false} className="mx-auto max-w-lg">
          <EmptyState icon="pulse" title="Checking your link…" description="One moment." />
        </Card>
      </ReporterLayout>
    )
  }

  if (status !== 'valid') {
    const copy = INVALID_STATES[status]
    return (
      <ReporterLayout title="Wellness check-in">
        <Card padded={false} className="mx-auto max-w-lg">
          <EmptyState icon={copy.icon} title={copy.title} description={copy.description} />
        </Card>
      </ReporterLayout>
    )
  }

  return (
    <ReporterLayout
      title="Wellness check-in"
      description={
        invite?.companyName
          ? `This check-in is for ${invite.companyName}.`
          : 'A short, confidential check-in from your organization.'
      }
    >
      <PulseSurveyForm
        inviteId={inviteId}
        token={token}
        companyName={invite?.companyName}
        questionSet={questionSet}
      />
    </ReporterLayout>
  )
}

export default PulseCheck
