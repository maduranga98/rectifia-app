import { useState } from 'react'
import { useParams } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import CaseAccess from '../components/intake/CaseAccess'
import CaseThread from '../components/intake/CaseThread'
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
      </div>
    </ReporterLayout>
  )
}

export default CaseDetail
