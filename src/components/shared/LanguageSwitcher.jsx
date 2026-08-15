import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../ui/Icon'
import { SUPPORTED_LANGUAGES } from '../../services/i18n'

const CODE_LABELS = {
  en: 'EN',
  si: 'SI',
}

// Each language's own name, in its own script - a Sinhala reader shouldn't
// have to already know English to find "සිංහල" in this list, and the same
// goes for whichever language gets added next.
const NATIVE_NAMES = {
  en: 'English',
  si: 'සිංහල',
}

// A dropdown, not a row of toggle buttons - the old version hard-coded two
// buttons side by side, which read fine at two languages but grows one
// button wider every time a language is added, and on the reporter's header
// that row is already competing with the logo, support link, and track-case
// button for the same line. A dropdown stays the same width - a code and a
// caret - no matter how many languages end up in SUPPORTED_LANGUAGES.
function LanguageSwitcher({ className = '' }) {
  const { i18n, t } = useTranslation()
  const current = SUPPORTED_LANGUAGES.includes(i18n.language) ? i18n.language : 'en'
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // A single language does nothing useful to switch between - render
  // nothing rather than a dropdown with one, unreachable, already-selected
  // option.
  if (SUPPORTED_LANGUAGES.length < 2) return null

  function choose(lng) {
    i18n.changeLanguage(lng)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language.switcher')}
        className="flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-charcoal transition-colors hover:border-navy-200"
      >
        <Icon name="globe" className="h-3.5 w-3.5 text-muted" />
        {CODE_LABELS[current] ?? current.toUpperCase()}
        <Icon name="chevronRight" className="h-3 w-3 rotate-90 text-muted" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('language.switcher')}
          className="absolute right-0 z-30 mt-1.5 min-w-[9rem] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {SUPPORTED_LANGUAGES.map((lng) => {
            const selected = current === lng
            return (
              <li key={lng} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(lng)}
                  className={`flex min-h-9 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm transition-colors ${
                    selected ? 'bg-navy-50 text-charcoal' : 'text-charcoal hover:bg-navy-50/60'
                  }`}
                >
                  <span>{NATIVE_NAMES[lng] ?? lng}</span>
                  {selected && <Icon name="check" className="h-3.5 w-3.5 text-navy" strokeWidth={3} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default LanguageSwitcher
