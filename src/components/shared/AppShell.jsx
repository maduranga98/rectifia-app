import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import Icon from '../ui/Icon'
import Logo from '../ui/Logo'

// The signed-in chrome: a navy rail carrying the brand and the navigation,
// and a light content column beside it.
//
// It replaces the old arrangement - a thin navy strip, a floating page
// title, and a row of underlined tabs - which gave every screen a different
// left edge and left the widest surfaces (the case table) boxed into a
// narrow centred column. Navigation lives in one fixed place here, so page
// bodies only ever have to lay out their own content.
//
// Nav items are either routed (`to`) or in-page views (`id` + onSelect);
// Company Admin's sub-pages are real routes, the Dashboard's role views are
// local state, and both need the same rail.

function NavItems({ items, activeId, onSelect, onNavigate }) {
  const base =
    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors'
  const idle = 'text-navy-200 hover:bg-white/8 hover:text-white'
  const active = 'bg-white/12 text-white shadow-[inset_2px_0_0_0_var(--color-gold)]'

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((item) =>
        item.to ? (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) => `${base} ${isActive ? active : idle}`}
          >
            {item.icon && <Icon name={item.icon} />}
            <span className="truncate">{item.label}</span>
          </NavLink>
        ) : (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onSelect?.(item.id)
              onNavigate?.()
            }}
            className={`${base} w-full text-left ${item.id === activeId ? active : idle}`}
          >
            {item.icon && <Icon name={item.icon} />}
            <span className="truncate">{item.label}</span>
          </button>
        )
      )}
    </nav>
  )
}

function SidebarBody({ scopeLabel, navItems, activeId, onSelect, onNavigate, userEmail, roleLabel, onSignOut }) {
  return (
    <div className="flex h-full flex-col bg-navy-900">
      <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-4">
        <Logo size="md" onDark subtitle={scopeLabel} />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {navItems.length > 0 && (
          <NavItems
            items={navItems}
            activeId={activeId}
            onSelect={onSelect}
            onNavigate={onNavigate}
          />
        )}
      </div>

      <div className="border-t border-white/8 p-3">
        {userEmail && (
          <div className="mb-2 flex items-center gap-2.5 rounded-lg px-2 py-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-semibold text-navy-900"
              aria-hidden="true"
            >
              {userEmail.slice(0, 2).toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-medium text-white">{userEmail}</span>
              {roleLabel && <span className="truncate text-xs text-navy-200">{roleLabel}</span>}
            </span>
          </div>
        )}
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-navy-200 transition-colors hover:bg-white/8 hover:text-white"
          >
            <Icon name="signOut" />
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}

function AppShell({
  scopeLabel,
  navItems = [],
  activeId,
  onSelect,
  userEmail,
  roleLabel,
  onSignOut,
  title,
  eyebrow,
  headerActions,
  children,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Esc closes the mobile drawer - it covers the whole viewport, so leaving
  // the keyboard without a way out of it is not an option.
  useEffect(() => {
    if (!drawerOpen) return
    function onKeyDown(e) {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const sidebar = (
    <SidebarBody
      scopeLabel={scopeLabel}
      navItems={navItems}
      activeId={activeId}
      onSelect={onSelect}
      onNavigate={() => setDrawerOpen(false)}
      userEmail={userEmail}
      roleLabel={roleLabel}
      onSignOut={onSignOut}
    />
  )

  return (
    <div className="min-h-screen">
      {/* Fixed rail on desktop. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {/* Drawer on small screens. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-navy-900/60 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 w-72 shadow-[var(--shadow-overlay)]">{sidebar}</div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="btn btn-secondary -ml-1 px-2 py-2 lg:hidden"
            >
              <Icon name="menu" className="h-5 w-5" />
            </button>

            <div className="min-w-0 flex-1">
              {eyebrow && (
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-subtle">
                  {eyebrow}
                </p>
              )}
              <h1 className="truncate text-lg font-semibold text-charcoal">{title}</h1>
            </div>

            {headerActions && (
              <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
            )}
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}

export default AppShell
