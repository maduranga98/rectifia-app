import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/translation.json'
import si from '../locales/si/translation.json'

export const SUPPORTED_LANGUAGES = ['en', 'si']
export const LANGUAGE_STORAGE_KEY = 'rectifia.language'

// No i18next-browser-languagedetector dependency: the app only ever offers
// two languages, so a stored preference plus a one-line navigator fallback
// covers it without another package to keep patched.
function detectLanguage() {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored && SUPPORTED_LANGUAGES.includes(stored)) return stored
  } catch {
    // localStorage can throw in private-browsing/blocked-storage contexts -
    // fall through to the navigator check below.
  }

  const browserLang = window.navigator.language?.slice(0, 2)
  return SUPPORTED_LANGUAGES.includes(browserLang) ? browserLang : 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    si: { translation: si },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (lng) => {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng)
  } catch {
    // Best-effort persistence only; the language still applies for the
    // current session even if it can't be remembered for the next one.
  }
  document.documentElement.lang = lng
})

document.documentElement.lang = i18n.language

export default i18n
