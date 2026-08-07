import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import CrisisResources from './CrisisResources'
import Icon from '../ui/Icon'
import Logo from '../ui/Logo'

// A reporter who already filed can only get back to their case through
// /case, and until this lived in the chrome the only links to it sat on two
// Submit screens - so anyone who closed the tab had to start a whole new
// report to find the tracking form. It belongs on every reporter-facing
// screen, which is exactly the set of screens this layout wraps.
//
// Suppressed on the tracking route itself: /case and /case/:caseId are where
// the link goes, and a link to the page you are on reads as a dead control.
function isTrackingRoute(pathname) {
  return pathname === '/case' || pathname.startsWith('/case/')
}

// Chrome for the account-less, self-serve pages: the anonymous reporter flow
// (/submit and /case/:caseId) and the roster-employee pulse check
// (/pulse/:inviteId, reached by an invite token, not a login). Deliberately
// not AppShell: there is no account, no navigation, and no role on any of
// these, and the page should not look like a staff dashboard the visitor has
// somehow been let into.
//
// `steps` renders a numbered progress trail when the page is a flow;
// omitting it gives a plain centred column.
//
// `unsavedWarning` is the text to confirm with before the tracking link
// navigates away. A page passes it while it holds work that only exists in
// component state (the half-filled questionnaire on /submit) and leaves it
// undefined otherwise, so the confirm only appears when there is genuinely
// something to lose.
function ReporterLayout({
  title,
  description,
  steps,
  currentStep,
  children,
  footerNote,
  unsavedWarning,
}) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // A persistent, low-key way to reach support resources from every
  // reporter-facing screen - no trigger has to fire, and nothing has to be
  // answered first. It expands a panel in place; it is never a modal that has
  // to be dismissed, and opening it is not recorded anywhere.
  const [showSupport, setShowSupport] = useState(false)

  // A plain <Link> can't ask first, and the answers live in React state that
  // unmounting would drop silently - so this navigates by hand, behind a
  // confirm the page opts into.
  function trackExistingCase() {
    if (unsavedWarning && !window.confirm(unsavedWarning)) return
    navigate('/case')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
          <Logo size="md" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSupport((open) => !open)}
              className="text-xs text-muted underline hover:text-charcoal"
              aria-expanded={showSupport}
            >
              Need support now?
            </button>
            {!isTrackingRoute(pathname) && (
              <Button size="sm" icon="search" onClick={trackExistingCase}>
                Track an existing case
              </Button>
            )}
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Icon name="shield" className="h-3.5 w-3.5" />
              Confidential
            </span>
          </div>
        </div>
        {/* Expands in place, below the chrome and above the page. It pushes the
            page down rather than covering it - the reporter is never blocked
            from what they were doing. The layout never knows a jurisdiction, so
            every regional route plus the international fallback is offered. */}
        {showSupport && (
          <div className="mx-auto w-full max-w-3xl px-5 pb-4">
            <CrisisResources />
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:py-12">
        {steps && (
          <ol className="mb-8 flex items-center gap-2">
            {steps.map((step, index) => {
              const done = index < currentStep
              const active = index === currentStep
              return (
                <li key={step} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                      done
                        ? 'bg-low text-white'
                        : active
                          ? 'bg-navy text-white'
                          : 'bg-line-soft text-muted'
                    }`}
                  >
                    {done ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                  </span>
                  <span
                    className={`hidden text-xs font-medium sm:block ${
                      active ? 'text-charcoal' : 'text-muted'
                    }`}
                  >
                    {step}
                  </span>
                  {index < steps.length - 1 && (
                    <span className="h-px flex-1 bg-line" aria-hidden="true" />
                  )}
                </li>
              )
            })}
          </ol>
        )}

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-charcoal sm:text-3xl">{title}</h1>
          {description && <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{description}</p>}
        </div>

        {children}
      </main>

      {/* Always rendered, on every reporter-facing screen - unlike footerNote
          (which is per-page and optional), the privacy/terms links are a
          standing requirement: both pages must be reachable with no auth and
          no Case ID from wherever a reporter happens to be. */}
      <footer className="border-t border-line px-5 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {footerNote && (
            <p className="max-w-xl text-xs leading-relaxed text-muted">{footerNote}</p>
          )}
          <nav className="flex items-center gap-4 text-xs text-muted">
            <Link to="/privacy" className="underline hover:text-charcoal">
              Privacy policy
            </Link>
            <Link to="/terms" className="underline hover:text-charcoal">
              Terms of use
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

export default ReporterLayout
