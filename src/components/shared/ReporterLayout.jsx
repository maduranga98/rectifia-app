import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import CrisisResources from './CrisisResources'
import Icon from '../ui/Icon'
import Logo from '../ui/Logo'
import LanguageSwitcher from './LanguageSwitcher'

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
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  // A persistent, low-key way to reach support resources from every
  // reporter-facing screen - no trigger has to fire, and nothing has to be
  // answered first. It floats over the page as a dismissible panel; it is
  // never a modal that has to be dismissed. Whoever renders it stays in full
  // control of their screen.
  const [showSupport, setShowSupport] = useState(false)
  const supportPanelRef = useRef(null)
  const supportToggleRef = useRef(null)

  // Dismiss on outside click or Escape, same as any other lightweight
  // disclosure panel - it stays reachable from the toggle by keyboard either
  // way since the toggle itself is a plain <button>.
  useEffect(() => {
    if (!showSupport) return undefined

    function handlePointerDown(event) {
      if (
        supportPanelRef.current?.contains(event.target) ||
        supportToggleRef.current?.contains(event.target)
      ) {
        return
      }
      setShowSupport(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setShowSupport(false)
        supportToggleRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showSupport])

  // A plain <Link> can't ask first, and the answers live in React state that
  // unmounting would drop silently - so this navigates by hand, behind a
  // confirm the page opts into.
  function trackExistingCase() {
    if (unsavedWarning && !window.confirm(unsavedWarning)) return
    navigate('/case')
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
          <Logo size="md" />
          <div className="flex items-center gap-3">
            <button
              ref={supportToggleRef}
              type="button"
              onClick={() => setShowSupport((open) => !open)}
              className="min-h-11 px-1 text-xs text-muted underline hover:text-charcoal"
              aria-expanded={showSupport}
            >
              {t('reporterLayout.needSupport')}
            </button>
            {!isTrackingRoute(pathname) && (
              <Button size="sm" icon="search" className="min-h-11" onClick={trackExistingCase}>
                {t('reporterLayout.trackExisting')}
              </Button>
            )}
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Icon name="shield" className="h-3.5 w-3.5" />
              {t('reporterLayout.confidential')}
            </span>
            <LanguageSwitcher />
          </div>
        </div>
        {/* Floats over the page, anchored below the chrome, instead of
            expanding in the document flow - it used to push <main> down,
            which meant a reporter scrolled up mid-form to open it and watched
            their place in the form jump beneath them. As an absolutely
            positioned overlay it covers nothing the reporter needs and never
            blocks them from what they were doing; it stays dismissible via
            outside click or Escape. The layout never knows a jurisdiction, so
            every regional route plus the international fallback is offered.
            The explicit button below exists alongside outside-click/Escape,
            not instead of them - a reporter who opened this from a form they
            were filling in needs a visible, unambiguous way back to it,
            not just an implicit one that depends on knowing to click outside
            the panel or press a key. */}
        {showSupport && (
          <div
            ref={supportPanelRef}
            className="absolute inset-x-0 top-full z-20 border-b border-line bg-surface shadow-lg"
          >
            <div className="mx-auto w-full max-w-3xl px-5 py-4">
              <CrisisResources />
              <Button
                className="mt-4"
                icon="back"
                onClick={() => {
                  setShowSupport(false)
                  supportToggleRef.current?.focus()
                }}
              >
                {t('reporterLayout.backToForm')}
              </Button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 sm:py-12">
        {steps && (
          <div className="mb-8 flex flex-col gap-2.5">
            {/* Named explicitly rather than left to the trail below - "Step 2
                of 4: Details, 2 to go" answers "how much is left" in one
                glance, which the numbered circles alone don't for someone
                skimming under stress. */}
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-charcoal">
                {t('reporterLayout.stepLabel', {
                  current: currentStep + 1,
                  total: steps.length,
                  name: steps[currentStep],
                })}
              </span>
              <span className="shrink-0 text-muted">
                {currentStep >= steps.length - 1
                  ? t('reporterLayout.lastStep')
                  : t('reporterLayout.stepsToGo', { count: steps.length - currentStep - 1 })}
              </span>
            </div>
            <ol className="flex items-center gap-2">
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
                            ? 'bg-navy text-white ring-2 ring-navy-200'
                            : 'bg-line-soft text-muted'
                      }`}
                      aria-hidden="true"
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
                      <span
                        className={`h-px flex-1 ${done ? 'bg-low' : 'bg-line'}`}
                        aria-hidden="true"
                      />
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
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
            {/* target="_blank" - a same-tab Link would unmount this page and
                drop whatever the reporter has already entered into the form,
                held only in React state. Opening in a new tab keeps that
                state intact with nothing to warn about, unlike the
                unsavedWarning confirm used for trackExistingCase(). */}
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-charcoal"
            >
              {t('reporterLayout.privacyPolicy')} <span className="text-muted">({t('common.opensNewTab')})</span>
            </Link>
            <Link
              to="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-charcoal"
            >
              {t('reporterLayout.termsOfUse')} <span className="text-muted">({t('common.opensNewTab')})</span>
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}

export default ReporterLayout
