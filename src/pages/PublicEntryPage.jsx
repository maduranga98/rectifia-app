import { Link } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import Alert from '../components/ui/Alert'
import Card from '../components/ui/Card'
import Icon from '../components/ui/Icon'

// What a signed-out visitor gets at "/" (and at any unknown URL). Previously
// they were sent straight to the staff login page, which offers a reporter
// nothing at all - no way back into a case they already filed, and no
// explanation of why there is no report button.
//
// This is a dispatcher, not a homepage: two routes out, and the one sentence
// a reporter needs to understand why filing starts somewhere else. It
// deliberately has nothing to sell.
//
// Note what is absent by design: no company picker, no slug field, no search.
// Reports are company-scoped by slug, and anything that resolved a typed name
// here would answer "is <employer> a Rectifia customer?" to anyone who asked.
// The reporting link the employer published is the only way in, and that is
// the point rather than a gap.
function PublicEntryPage() {
  return (
    <ReporterLayout
      title="Rectifia"
      description="Confidential workplace reporting. Choose where you're headed."
    >
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy">
                <Icon name="search" className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-charcoal">
                  Track an existing case
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  Already filed a report? Enter the Case ID and passcode you were given at the
                  time to read your handler&apos;s replies and send a message back. No account,
                  no sign-in.
                </p>
              </div>
            </div>
            <Link to="/case" className="btn btn-primary self-start">
              Track an existing case
            </Link>
          </div>
        </Card>

        <Alert variant="info" title="Filing a new report starts with your employer's link">
          Reports go to one specific company, so they can only be filed through the reporting
          link or QR code your employer published - on a noticeboard, an intranet page, or a
          handbook. There is no way to look a company up from here. If you don&apos;t have the
          link, ask however your workplace shares it.
        </Alert>

        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy">
                <Icon name="shield" className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-charcoal">Staff sign in</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  For case handlers, HR coordinators, managers, and administrators with a
                  Rectifia account.
                </p>
              </div>
            </div>
            <Link to="/login" className="btn btn-secondary self-start">
              Staff sign in
            </Link>
          </div>
        </Card>

        <p className="text-xs leading-relaxed text-muted">
          Lost your Case ID or passcode? Neither is stored in a form anyone can read back, so
          they cannot be recovered or reset - not by us, and not by your employer. Filing a new
          report is the only way forward.
        </p>
      </div>
    </ReporterLayout>
  )
}

export default PublicEntryPage
