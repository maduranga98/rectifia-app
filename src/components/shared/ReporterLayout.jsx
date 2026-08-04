import Icon from '../ui/Icon'
import Logo from '../ui/Logo'

// Chrome for the account-less, self-serve pages: the anonymous reporter flow
// (/submit and /case/:caseId) and the roster-employee pulse check
// (/pulse/:inviteId, reached by an invite token, not a login). Deliberately
// not AppShell: there is no account, no navigation, and no role on any of
// these, and the page should not look like a staff dashboard the visitor has
// somehow been let into.
//
// `steps` renders a numbered progress trail when the page is a flow;
// omitting it gives a plain centred column.
function ReporterLayout({ title, description, steps, currentStep, children, footerNote }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Logo size="md" />
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="shield" className="h-3.5 w-3.5" />
            Confidential
          </span>
        </div>
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

      {footerNote && (
        <footer className="border-t border-line px-5 py-5">
          <p className="mx-auto max-w-3xl text-xs leading-relaxed text-muted">{footerNote}</p>
        </footer>
      )}
    </div>
  )
}

export default ReporterLayout
