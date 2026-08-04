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
}

function PulseCheck() {
  const { inviteId } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t')

  // status: 'loading' | 'valid' | 'used' | 'expired' | 'invalid'
  const [status, setStatus] = useState('loading')
  const [invite, setInvite] = useState(null)

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
          setStatus('valid')
        } else {
          // Coarse reason from the server; anything unrecognised is treated as
          // an invalid link rather than guessed at.
          setStatus(INVALID_STATES[result.reason] ? result.reason : 'invalid')
        }
      } catch {
        // Network error, rate-limited invite, or any unexpected failure: fall
        // back to the invalid-link copy rather than a raw error string.
        if (!cancelled) setStatus('invalid')
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
      <PulseSurveyForm inviteId={inviteId} token={token} companyName={invite?.companyName} />
    </ReporterLayout>
  )
}

export default PulseCheck
