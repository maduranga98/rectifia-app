import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Logo from '../components/ui/Logo'
import Alert from '../components/ui/Alert'
import { policyVersion, isDraft, lastUpdated, getTermsContent } from '../content/legal/terms'

// Same body-rendering shape as PrivacyPolicyPage.jsx's SectionBody - a string
// is a paragraph, an array of strings is a bullet list. Kept as a small local
// copy rather than a shared component: two nearly-identical static pages
// don't need a shared abstraction between them, and it keeps each page free
// to diverge later without a refactor.
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

// Reachable with no auth and no Case ID - see PrivacyPolicyPage.jsx's header
// comment for why this has its own minimal chrome rather than ReporterLayout,
// and for the caveat on the localized legal body text below.
function TermsPage() {
  const { t, i18n } = useTranslation()
  const { draftNotice, sections } = getTermsContent(i18n.language)

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to="/">
            <Logo size="md" />
          </Link>
          <Link to="/" className="text-xs text-muted underline hover:text-charcoal">
            {t('legal.backToHome')}
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8 sm:py-12">
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
          <h1 className="text-2xl font-semibold text-charcoal sm:text-3xl">{t('legal.termsTitle')}</h1>
          <p className="mt-2 text-xs text-muted">
            {t('legal.version', { version: policyVersion })} · {t('legal.lastUpdated', { date: lastUpdated })}
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
          <span>{t('app.name')}</span>
          <Link to="/privacy" className="underline hover:text-charcoal">
            {t('reporterLayout.privacyPolicy')}
          </Link>
        </div>
      </footer>
    </div>
  )
}

export default TermsPage
