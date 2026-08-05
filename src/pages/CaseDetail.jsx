import { useState } from 'react'
import { useParams } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import CaseAccess from '../components/intake/CaseAccess'
import CaseThread from '../components/intake/CaseThread'
import ContactChannelPanel from '../components/intake/ContactChannelPanel'
import IdentityUpgradePanel from '../components/intake/IdentityUpgradePanel'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'

// The reporter's view of their own case. CaseAccess and CaseThread were
// both already built but nothing rendered them, so this route showed only
// "Case <id>"; it now gates the thread behind the Case ID + passcode check
// those components were written for.
//
// The passcode is held in component state only for as long as the tab is
// open - CaseThread needs it on every poll (the messages subcollection is
// not client-readable, so each fetch re-verifies through the callable), and
// persisting it anywhere would turn an anonymous, credential-in-hand flow
// into a stored session.
//
// Reachable with or without a :caseId in the URL: a link from a submission
// carries it, a reporter arriving cold at /case types it in.
function CaseDetail() {
  const { caseId: caseIdFromUrl } = useParams()
  const [grantedCase, setGrantedCase] = useState(null)
  const [passcode, setPasscode] = useState(null)

  if (!grantedCase) {
    return (
      <ReporterLayout
        title="Access your case"
        description="No account needed. Enter the Case ID and passcode you were given when you submitted your report."
        footerNote="Lost your Case ID or passcode? They cannot be recovered - neither is stored in a readable form. You would need to submit a new report."
      >
        <div className="max-w-md">
          <CaseAccess
            initialCaseId={caseIdFromUrl ?? ''}
            onAccessGranted={(result, enteredPasscode) => {
              setGrantedCase(result)
              setPasscode(enteredPasscode)
            }}
          />
        </div>
      </ReporterLayout>
    )
  }

  const caseNumber = grantedCase.caseId ?? caseIdFromUrl
  // Both panels below act on state that lives on the case document, so after a
  // change the local copy is stale. Rather than refetch (which would mean
  // re-sending the passcode for no new information), each transition reports
  // its own outcome and we patch the one field it changed - the callables are
  // the source of truth for whether it succeeded.
  const isOpen = grantedCase.status !== 'closed'
  const isAnonymous = (grantedCase.tier ?? 'anonymous') === 'anonymous'

  return (
    <ReporterLayout
      title={`Case ${caseNumber}`}
      description="Messages here go to the handler assigned to your case. Everything is kept on the case record."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={grantedCase.status === 'closed' ? 'tone-low' : 'tone-info'} dot>
            {(grantedCase.status ?? 'open').replace(/_/g, ' ')}
          </Badge>
          {grantedCase.category && (
            <span className="text-sm text-muted">{grantedCase.category.replace(/_/g, ' ')}</span>
          )}
        </div>

        <Card title="Case thread">
          <CaseThread caseId={caseNumber} mode="reporter" passcode={passcode} />
        </Card>

        {/* Blueprint §7.2 and §8, beneath the thread rather than above it: both
            are optional, neither is what the reporter came here to do, and
            putting either where a reply belongs would make it feel asked for.
            Both are collapsed until opened, and nothing in the app - staff, AI,
            or system - ever points a reporter at them. */}
        {isOpen && isAnonymous && (
          <IdentityUpgradePanel
            caseId={caseNumber}
            passcode={passcode}
            onUpgraded={() => setGrantedCase((prev) => ({ ...prev, tier: 'confidential' }))}
          />
        )}

        {/* Offered at either tier: wanting to know when something moves is not
            the same question as wanting to be known, and a confidential-tier
            reporter has just as little reason to sit refreshing this page. */}
        {isOpen && (
          <ContactChannelPanel
            caseId={caseNumber}
            passcode={passcode}
            hasContactEmail={Boolean(grantedCase.hasContactEmail)}
            onChanged={() =>
              setGrantedCase((prev) => ({ ...prev, hasContactEmail: !prev.hasContactEmail }))
            }
          />
        )}
      </div>
    </ReporterLayout>
  )
}

export default CaseDetail
