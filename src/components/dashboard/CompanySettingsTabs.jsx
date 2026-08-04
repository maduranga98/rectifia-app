import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/admin/departments', label: 'Departments' },
  { to: '/admin/staff', label: 'Staff' },
  { to: '/admin/routing', label: 'Routing rules' },
  { to: '/admin/billing', label: 'Billing' },
]

// Tab nav for the four company settings sub-pages. Mirrors the border-b-2
// active-indicator pattern Dashboard.jsx uses for its own role-based tabs,
// so Company Admin's surface looks consistent with the rest of the app.
function CompanySettingsTabs() {
  return (
    <nav className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-4xl gap-1 px-6">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `border-b-2 px-3 py-3 text-sm font-medium ${
                isActive ? 'border-navy text-charcoal' : 'border-transparent text-muted hover:text-charcoal'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export default CompanySettingsTabs
