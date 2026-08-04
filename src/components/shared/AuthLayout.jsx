import Icon from '../ui/Icon'
import Logo from '../ui/Logo'

const POINTS = [
  {
    icon: 'shield',
    title: 'Confidential by design',
    body: 'Reports are handled on a need-to-know basis, and each role only ever sees the case data it is entitled to.',
  },
  {
    icon: 'clock',
    title: 'Deadlines tracked for you',
    body: 'Acknowledgment and feedback windows are calculated per jurisdiction and counted down on every case.',
  },
  {
    icon: 'routing',
    title: 'Routed to the right handler',
    body: 'Category and department rules assign new cases automatically the moment they are submitted.',
  },
]

// Shared frame for every signed-out screen (sign in, password reset, invite
// acceptance). The brand panel is the point: these pages used to be a bare
// form floating on the app canvas, indistinguishable from a half-loaded
// dashboard. The panel is decorative and hidden below `lg`, where the form
// is all the screen has room for.
function AuthLayout({ title, description, children, footer }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="auth-backdrop relative hidden w-[46%] max-w-2xl flex-col justify-between p-12 lg:flex">
        <Logo size="lg" onDark />

        <div className="flex flex-col gap-8">
          <div>
            <h2 className="text-3xl font-semibold leading-tight text-white">
              Speak up safely.
              <br />
              Resolve it properly.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-navy-200">
              Rectifia is the workplace reporting and case-management platform behind
              confidential disclosures, investigations, and compliance deadlines.
            </p>
          </div>

          <ul className="flex flex-col gap-5">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-200">
                  <Icon name={point.icon} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-white">{point.title}</span>
                  <span className="max-w-sm text-xs leading-relaxed text-navy-200">{point.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-navy-300">A Lumora product</p>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-7 flex flex-col gap-5">
            <span className="lg:hidden">
              <Logo size="md" />
            </span>
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
