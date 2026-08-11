import { useTranslation } from 'react-i18next'
import Icon from '../ui/Icon'
import { SUPPORTED_LANGUAGES } from '../../services/i18n'

const LABELS = {
  en: 'EN',
  si: 'SI',
}

// A two-way toggle rather than a <select>: with only two languages, a
// select adds a dropdown interaction for a choice that's one tap either
// way, and the current language stays visibly readable at rest.
function LanguageSwitcher({ className = '' }) {
  const { i18n, t } = useTranslation()
  const current = SUPPORTED_LANGUAGES.includes(i18n.language) ? i18n.language : 'en'

  return (
    <div
      role="group"
      aria-label={t('language.switcher')}
      className={`flex items-center gap-1 rounded-full border border-line bg-surface p-0.5 text-xs ${className}`}
    >
      <Icon name="globe" className="ml-1.5 h-3.5 w-3.5 text-muted" />
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => i18n.changeLanguage(lng)}
          aria-pressed={current === lng}
          className={`min-h-7 rounded-full px-2 py-1 font-medium transition-colors ${
            current === lng ? 'bg-navy text-white' : 'text-muted hover:text-charcoal'
          }`}
        >
          {LABELS[lng]}
        </button>
      ))}
    </div>
  )
}

export default LanguageSwitcher
