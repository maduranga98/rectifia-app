import { useTranslation } from 'react-i18next'
import { resolveResources } from '../../data/crisisResources'
import Icon from '../ui/Icon'

// A calm, presentational panel that signposts to real external support
// services. It renders resources for a given jurisdiction set, always with the
// international fallback alongside.
//
// What this component deliberately does NOT do:
//   - It never blocks, gates, interrupts, or redirects anything. It is a panel
//     that appears; it is never a modal that must be dismissed. Whoever renders
//     it stays in full control of their screen.
//   - It records nothing. Viewing this panel is not logged, stored, or
//     transmitted anywhere - no analytics event, no Firestore write, no field
//     on any case. That a reporter looked at it must never become a signal
//     anyone can read.
//   - It never tells the reporter what the system inferred about them. There is
//     no "you appear to be...", no diagnosis, no assessment. It offers help; it
//     does not describe the person reading it.
//   - It offers no coping tips or self-help techniques. It signposts to real
//     services and nothing more.
//
// Tone is plain and non-clinical. `heading` and `intro` can be overridden per
// placement; the defaults suit an inline appearance.
function CrisisResources({
  jurisdictions,
  heading,
  intro,
  className = '',
}) {
  const { t } = useTranslation()
  const resources = resolveResources(jurisdictions)

  return (
    <section
      className={`rounded-xl border border-line bg-navy-50/60 p-5 ${className}`}
      aria-label={t('crisisResources.ariaLabel')}
    >
      <div className="flex items-start gap-2.5">
        <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-navy" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-charcoal">{heading ?? t('crisisResources.heading')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{intro ?? t('crisisResources.intro')}</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {resources.map((resource) => (
          <li
            key={`${resource.jurisdiction}-${resource.name}`}
            className="rounded-lg border border-line bg-surface px-3.5 py-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium text-charcoal">{resource.name}</span>
              <span className="text-sm font-semibold text-navy">{resource.contact}</span>
            </div>
            <p className="mt-0.5 text-xs text-muted">{resource.hours}</p>
            {resource.notes && (
              <p className="mt-1 text-xs leading-relaxed text-muted">{resource.notes}</p>
            )}
          </li>
        ))}
      </ul>

      {/* Stated plainly, not buried: what Rectifia does and does not know, and
          that it cannot summon help. We make no confidentiality claim about the
          external services above - each one speaks for itself. */}
      <p className="mt-4 text-xs leading-relaxed text-muted">{t('crisisResources.disclaimer')}</p>
    </section>
  )
}

export default CrisisResources
