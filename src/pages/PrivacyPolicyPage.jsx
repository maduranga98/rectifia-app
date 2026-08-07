import { Link } from 'react-router-dom'
import Logo from '../components/ui/Logo'
import Alert from '../components/ui/Alert'
import {
  policyVersion,
  isDraft,
  lastUpdated,
  draftNotice,
  sections,
} from '../content/legal/privacyPolicy'

// A section's body is an array of items - a string is a paragraph, an array
// of strings is a bullet list. Kept this simple (rather than a richer schema)
// because it's the smallest shape that fits every section privacyPolicy.js
// actually needs, and it's shared verbatim with TermsPage.jsx.
function SectionBody({ body }) {
  return (
    <div className="flex flex-col gap-3">
      {body.map((item, index) =>
        Array.isArray(item) ? (
          <ul key={index} className="flex list-disc flex-col gap-1.5 pl-5">
            {item.map((point, pointIndex) => (
              <li key={pointIndex} className="text-sm leading-relaxed text-muted">
                {point}
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="text-sm leading-relaxed text-muted">
            {item}
          </p>
        )
      )}
    </div>
  )
}

// Reachable with no auth and no Case ID - linked from the reporter layout
// footer, the staff login page, and the pre-submission data-handling notice.
// Deliberately not wrapped in ReporterLayout: this page belongs to nobody's
// flow in particular (a reporter mid-report, a visitor who followed a staff
// login link, a Manager reading it cold all land here the same way), so it
// gets its own minimal chrome instead of borrowing one flow's.
function PrivacyPolicyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to="/">
            <Logo size="md" />
          </Link>
          <Link to="/" className="text-xs text-muted underline hover:text-charcoal">
            Back to Rectifia
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8 sm:py-12">
        {/* The one flag (isDraft, in src/content/legal/privacyPolicy.js) that
            controls this banner. It is rendered first, before the title,
            precisely so it cannot be scrolled past unseen. */}
        {isDraft && (
          <Alert variant="warning" title={draftNotice.heading}>
            {draftNotice.body.map((paragraph, index) => (
              <p key={index} className={index > 0 ? 'mt-2' : ''}>
                {paragraph}
              </p>
            ))}
          </Alert>
        )}

        <div>
          <h1 className="text-2xl font-semibold text-charcoal sm:text-3xl">Privacy Policy</h1>
          <p className="mt-2 text-xs text-muted">
            Version {policyVersion} · Last updated {lastUpdated}
          </p>
        </div>

        <div className="flex flex-col gap-8">
          {sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-charcoal">{section.heading}</h2>
              <SectionBody body={section.body} />
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t border-line px-5 py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between text-xs text-muted">
          <span>Rectifia</span>
          <Link to="/terms" className="underline hover:text-charcoal">
            Terms of use
          </Link>
        </div>
      </footer>
    </div>
  )
}

export default PrivacyPolicyPage
