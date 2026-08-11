import { useTranslation } from 'react-i18next'
import Icon from '../ui/Icon'
import Logo from '../ui/Logo'
import LanguageSwitcher from './LanguageSwitcher'

const POINT_KEYS = [
  { icon: 'shield', key: 'confidential' },
  { icon: 'clock', key: 'deadlines' },
  { icon: 'routing', key: 'routing' },
]

// Shared frame for every signed-out screen (sign in, password reset, invite
// acceptance). The brand panel is the point: these pages used to be a bare
// form floating on the app canvas, indistinguishable from a half-loaded
// dashboard. The panel is decorative and hidden below `lg`, where the form
// is all the screen has room for.
function AuthLayout({ title, description, children, footer }) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="auth-backdrop relative hidden w-[46%] max-w-2xl flex-col justify-between p-12 lg:flex">
        <Logo size="lg" onDark />

        <div className="flex flex-col gap-8">
          <div>
            <h2 className="text-3xl font-semibold leading-tight text-white">
              {t('authLayout.tagline.line1')}
              <br />
              {t('authLayout.tagline.line2')}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-navy-200">
              {t('authLayout.description')}
            </p>
          </div>

          <ul className="flex flex-col gap-5">
            {POINT_KEYS.map((point) => (
              <li key={point.key} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-200">
                  <Icon name={point.icon} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-white">
                    {t(`authLayout.points.${point.key}.title`)}
                  </span>
                  <span className="max-w-sm text-xs leading-relaxed text-navy-200">
                    {t(`authLayout.points.${point.key}.body`)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-navy-300">{t('authLayout.byline')}</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-7 flex flex-col gap-5">
            <div className="flex items-center justify-between lg:justify-end">
              <span className="lg:hidden">
                <Logo size="md" />
              </span>
              <LanguageSwitcher />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-charcoal">{title}</h1>
              {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
            </div>
          </div>

          {children}

          {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

export default AuthLayout
