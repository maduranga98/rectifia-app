import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveResources } from '../../data/crisisResources'
import Icon from '../ui/Icon'

// A calm, presentational panel that signposts to real external support
// services. It renders resources for a given jurisdiction set (or, absent
// one, a browser-timezone best guess - see resolveResources), always with the
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
function ResourceItem({ resource }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium text-charcoal">{resource.name}</span>
        <span className="text-sm font-semibold text-navy">{resource.contact}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{resource.hours}</p>
      {resource.notes && (
        <p className="mt-1 text-xs leading-relaxed text-muted">{resource.notes}</p>
      )}
    </li>
  )
}

function CrisisResources({
  jurisdictions,
  heading,
  intro,
  className = '',
}) {
  const { t } = useTranslation()
  const { primary, other } = resolveResources(jurisdictions)
  const rootRef = useRef(null)
  // Fires once, on the render that first mounts this panel - never again on
  // later re-renders while it stays on screen. `nearest` (not `start` or
  // `center`) means it does nothing if the panel is already inside the
  // viewport, and neither this nor anything else in this component ever
  // moves focus - the reporter's caret stays exactly where they were typing.
  const hasScrolled = useRef(false)
  useEffect(() => {
    if (hasScrolled.current) return
    hasScrolled.current = true
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  return (
    <section
      ref={rootRef}
      role="status"
      aria-live="polite"
      className={`rounded-xl border border-line border-l-4 border-l-navy bg-surface p-5 shadow-[var(--shadow-card)] ${className}`}
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
        {primary.map((resource) => (
          <ResourceItem key={`${resource.jurisdiction}-${resource.name}`} resource={resource} />
        ))}
      </ul>

      {other.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-navy">
            {t('crisisResources.otherCountries')}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {other.map((group) => (
              <div key={group.jurisdiction}>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">{group.label}</p>
                <ul className="mt-2 flex flex-col gap-3">
                  {group.entries.map((resource) => (
                    <ResourceItem key={`${resource.jurisdiction}-${resource.name}`} resource={resource} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Stated plainly, not buried: what Rectifia does and does not know, and
          that it cannot summon help. We make no confidentiality claim about the
          external services above - each one speaks for itself. */}
      <p className="mt-4 text-xs leading-relaxed text-muted">{t('crisisResources.disclaimer')}</p>
    </section>
  )
}

export default CrisisResources
