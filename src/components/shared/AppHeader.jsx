// Deep navy top bar - the brand's designated surface for headers and nav.
// `subtitle` carries the scope of the current view (platform vs company) and
// `actions` holds whatever the screen puts on the right, usually sign-out.
function AppHeader({ title, subtitle, actions }) {
  return (
    <header className="bg-navy text-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-gold" aria-hidden="true" />
            <span className="text-base font-semibold tracking-tight">{title}</span>
          </div>
          {subtitle && <p className="text-xs text-navy-200">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export default AppHeader
