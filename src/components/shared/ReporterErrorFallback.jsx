import { Link, useParams } from 'react-router-dom'
import CrisisResources from './CrisisResources'
import Icon from '../ui/Icon'
import Logo from '../ui/Logo'

// The ErrorBoundary fallback for every unauthenticated reporter-facing route
// (/submit/:companySlug, /case, /case/:caseId, /pulse/:inviteId,
// /shared/:shareId). Self-contained: it renders with no props beyond what
// the route's own URL params give it, so App.jsx can drop it in identically
// at each of those routes.
//
// Deliberately does NOT show: a staff sign-in link, the caught error's
// message or stack, or anything that references internal roles. Whoever
// lands here is a reporter, roster employee, or advisor, not staff - the
// screen must read the same way DefaultFallback deliberately does not.
//
// Crisis resources are always included, not conditionally: this fallback has
// no way to know whether the screen that crashed was crisis-flagged, and the
// one thing worse than showing the panel unnecessarily is a crash silently
// taking it away from someone who needed it.
function ReporterErrorFallback() {
  const { caseId } = useParams()

  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas px-5 py-10">
      <Logo size="md" />

      <div className="card mt-8 w-full max-w-md p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-navy-50">
          <Icon name="alert" className="h-5 w-5 text-navy" />
        </div>
        <h1 className="mt-3 text-lg font-semibold text-charcoal">Something went wrong on our end</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {caseId
            ? 'This screen hit a problem loading, but your report was not lost — it is saved under the Case ID below.'
            : 'This screen hit a problem loading. If you had already submitted a report, it was not lost.'}
        </p>

        {caseId && (
          <p className="mt-3 rounded-lg border border-line bg-navy-50/60 px-3 py-2 text-sm font-semibold text-navy">
            Case ID: {caseId}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button type="button" onClick={() => window.location.reload()} className="btn btn-secondary">
            <Icon name="refresh" className="h-4 w-4" />
            Reload
          </button>
          <Link to="/case" className="btn btn-accent">
            Track a case
          </Link>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted">
          Use your Case ID and passcode on the tracking page to view or continue your report.
        </p>
      </div>

      <div className="mt-6 w-full max-w-md">
        <CrisisResources />
      </div>
    </div>
  )
}

export default ReporterErrorFallback
