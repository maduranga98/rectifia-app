import { useState } from 'react'
import {
  SELECTABLE_JURISDICTIONS,
  createCompany,
  createCompanyAdmin,
  createDepartment,
  getStrictestJurisdiction,
  slugifyCompanyName,
} from '../../services/companyService'
import CompanyCredentials from './CompanyCredentials'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Input } from '../ui/Field'

const JURISDICTION_LABELS = {
  EU: 'European Union',
  UK: 'United Kingdom',
  US: 'United States',
  AU: 'Australia',
  JP: 'Japan',
  LK: 'Sri Lanka',
}

// Registers a new company. This is the Super Admin's onboarding form (see
// SuperAdminDashboardPage) - it was previously written but never rendered
// on any route, which is why there was no way to register a company at all.
//
// `title` is optional: when this form is dropped into a card that already
// has a heading, passing null keeps the page from stating the same thing
// twice.
function CompanySetup({ onCreated, onCancel, title = 'Company setup' }) {
  const [name, setName] = useState('')
  // Prefilled from the company name (slugifyCompanyName) but editable - a
  // Super Admin can pick a shorter or clearer reporting-link slug than what
  // the name would auto-generate. Left blank, createCompany falls back to the
  // name-derived slug itself. Tracks whether the admin has typed into this
  // field directly, so it keeps auto-following the name until they do.
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [jurisdictions, setJurisdictions] = useState([])
  const [departments, setDepartments] = useState([])
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  // Set as soon as the company doc exists. Kept in state so that if the
  // Company Admin account fails to be created afterwards (duplicate email,
  // say), retrying reuses the company instead of registering a second one.
  const [companyId, setCompanyId] = useState(null)
  // { email, inviteLink } returned by createCompanyAdmin - the invite link
  // that lets the new admin set their own password. No password is ever
  // generated or shown here; it's the same link-based flow inviteStaff.js
  // uses for staff.
  const [credentials, setCredentials] = useState(null)

  const strictestJurisdiction = getStrictestJurisdiction(jurisdictions)

  function toggleJurisdiction(code) {
    setJurisdictions((current) =>
      current.includes(code) ? current.filter((j) => j !== code) : [...current, code]
    )
  }

  function addDepartment() {
    const names = newDepartmentName
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    if (names.length === 0) return
    setDepartments((current) => {
      const existingNames = new Set(current.map((dept) => dept.name.toLowerCase()))
      const additions = []
      for (const name of names) {
        const key = name.toLowerCase()
        if (existingNames.has(key)) continue
        existingNames.add(key)
        additions.push(createDepartment({ name }))
      }
      return [...current, ...additions]
    })
    setNewDepartmentName('')
  }

  function removeDepartment(id) {
    setDepartments((current) => current.filter((dept) => dept.id !== id))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // Reuses the company from a previous attempt whose admin step failed,
      // so a retry doesn't register a duplicate company.
      const id =
        companyId ??
        (await createCompany({ name, jurisdictions, departments, slug }))
      setCompanyId(id)

      const admin = await createCompanyAdmin({ companyId: id, email: adminEmail })
      setCredentials({ email: admin.email, inviteLink: admin.inviteLink, emailDelivered: admin.emailDelivered })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // The credentials screen replaces the form so the Super Admin can copy the
  // invite link as a backup before moving on, in case the email fails to
  // deliver.
  if (credentials) {
    return (
      <CompanyCredentials
        companyName={name}
        email={credentials.email}
        inviteLink={credentials.inviteLink}
        emailDelivered={credentials.emailDelivered}
        onDone={() => onCreated?.(companyId)}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {title && <h2 className="text-lg font-semibold text-charcoal">{title}</h2>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Company name"
          type="text"
          value={name}
          onChange={(e) => {
            const value = e.target.value
            setName(value)
            if (!slugEdited) setSlug(slugifyCompanyName(value))
          }}
          required
          placeholder="Acme Ltd"
        />
        <Input
          label="Reporting link slug"
          type="text"
          value={slug}
          onChange={(e) => {
            setSlugEdited(true)
            setSlug(e.target.value)
          }}
          placeholder={slugifyCompanyName(name) || 'acme-ltd'}
          hint="Appears in the public reporting link (/submit/:slug). Left blank, it's generated from the company name. Normalized to lowercase letters, numbers and hyphens, and must be unique platform-wide."
        />
      </div>

      <Input
        label="Company Admin email"
        type="email"
        value={adminEmail}
        onChange={(e) => setAdminEmail(e.target.value)}
        required
        placeholder="admin@company.com"
        hint="A Company Admin account is created with this email, and a link to set a password is emailed to it directly. The same link is also shown on the next screen in case you need to hand it over yourself."
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-charcoal">Jurisdictions</legend>
        <p className="text-xs text-muted">
          Select every jurisdiction the company operates in. Compliance deadlines follow the
          strictest one selected.
        </p>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {SELECTABLE_JURISDICTIONS.map((code) => {
            const checked = jurisdictions.includes(code)
            return (
              <label
                key={code}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  checked
                    ? 'border-navy bg-navy-50 text-charcoal'
                    : 'border-line bg-surface text-muted hover:border-navy-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleJurisdiction(code)}
                  className="h-4 w-4"
                />
                <span className="font-medium text-charcoal">{code}</span>
                <span className="truncate text-xs">{JURISDICTION_LABELS[code]}</span>
              </label>
            )
          })}
        </div>
        {jurisdictions.length > 1 && strictestJurisdiction && (
          <Alert variant="info" className="mt-1">
            Default compliance timeline will follow <strong>{strictestJurisdiction}</strong>, the
            strictest of the selected jurisdictions, unless overridden per-jurisdiction later.
          </Alert>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-charcoal">Departments</span>
        <p className="text-xs text-muted">
          Departments feed case routing. You can assign a department head later. Add several at
          once by separating names with commas.
        </p>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            aria-label="Department name"
            value={newDepartmentName}
            onChange={(e) => setNewDepartmentName(e.target.value)}
            onKeyDown={(e) => {
              // Enter inside this input would otherwise submit the whole
              // registration form instead of adding a department.
              if (e.key === 'Enter') {
                e.preventDefault()
                addDepartment()
              }
            }}
            placeholder="e.g. Engineering, Sales, Legal"
            className="field flex-1"
          />
          <Button icon="plus" onClick={addDepartment} disabled={!newDepartmentName.trim()}>
            Add
          </Button>
        </div>
        {departments.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-2">
            {departments.map((dept) => (
              <li
                key={dept.id}
                className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-3 pr-1.5 text-sm"
              >
                <span>{dept.name}</span>
                <button
                  type="button"
                  onClick={() => removeDepartment(dept.id)}
                  aria-label={`Remove ${dept.name}`}
                  className="rounded-full p-0.5 text-muted transition-colors hover:bg-navy-50 hover:text-critical"
                >
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <Alert variant="error" title={companyId ? 'Company registered, admin account was not' : undefined}>
          {error}
          {companyId && (
            <p className="mt-1">
              <strong>{name}</strong> already exists. Fix the email above and submit again - this
              will not register the company a second time.
            </p>
          )}
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          loadingLabel="Creating"
          disabled={!name.trim() || !adminEmail.trim() || jurisdictions.length === 0}
        >
          {companyId ? 'Create admin account' : 'Create company'}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

export default CompanySetup
