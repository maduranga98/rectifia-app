import { useState } from 'react'
import {
  JURISDICTIONS,
  SUBSCRIPTION_TIERS,
  createCompany,
  createCompanyAdmin,
  createDepartment,
  getStrictestJurisdiction,
} from '../../services/companyService'
import CompanyCredentials from './CompanyCredentials'

const JURISDICTION_LABELS = {
  EU: 'European Union',
  UK: 'United Kingdom',
  US: 'United States',
  LK: 'Sri Lanka',
}

// Registers a new company. This is the Super Admin's onboarding form (see
// SuperAdminDashboardPage) - it was previously written but never rendered
// on any route, which is why there was no way to register a company at all.
function CompanySetup({ onCreated, onCancel, title = 'Company setup' }) {
  const [name, setName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [jurisdictions, setJurisdictions] = useState([])
  const [subscriptionTier, setSubscriptionTier] = useState(
    SUBSCRIPTION_TIERS[0]
  )
  const [departments, setDepartments] = useState([])
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  // Set as soon as the company doc exists. Kept in state so that if the
  // Company Admin account fails to be created afterwards (duplicate email,
  // say), retrying reuses the company instead of registering a second one.
  const [companyId, setCompanyId] = useState(null)
  // { email, password } returned once by createCompanyAdmin - the only time
  // the password is ever available, since nothing stores it.
  const [credentials, setCredentials] = useState(null)

  const strictestJurisdiction = getStrictestJurisdiction(jurisdictions)

  function toggleJurisdiction(code) {
    setJurisdictions((current) =>
      current.includes(code)
        ? current.filter((j) => j !== code)
        : [...current, code]
    )
  }

  function addDepartment() {
    const trimmed = newDepartmentName.trim()
    if (!trimmed) return
    setDepartments((current) => [...current, createDepartment({ name: trimmed })])
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
        (await createCompany({
          name,
          jurisdictions,
          departments,
          subscriptionTier,
        }))
      setCompanyId(id)

      const admin = await createCompanyAdmin({ companyId: id, email: adminEmail })
      setCredentials({ email: admin.email, password: admin.password })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // The credentials replace the form: the password is shown exactly once and
  // is unrecoverable afterwards, so the Super Admin has to be able to sit on
  // this screen and copy it before moving on.
  if (credentials) {
    return (
      <CompanyCredentials
        companyName={name}
        email={credentials.email}
        password={credentials.password}
        onDone={() => onCreated?.(companyId)}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      <h2 className="text-lg font-semibold">{title}</h2>

      <div>
        <label htmlFor="company-name" className="block text-sm font-medium">
          Company name
        </label>
        <input
          id="company-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="field mt-1 w-full rounded px-3 py-2"
        />
      </div>

      <div>
        <label htmlFor="company-admin-email" className="block text-sm font-medium">
          Company Admin email
        </label>
        <p className="mt-1 text-xs text-muted">
          A Company Admin account is created with this email. No invitation is
          sent for now - the login credentials are shown on the next screen for
          you to hand over.
        </p>
        <input
          id="company-admin-email"
          type="email"
          value={adminEmail}
          onChange={(e) => setAdminEmail(e.target.value)}
          required
          placeholder="admin@company.com"
          className="field mt-2 w-full rounded px-3 py-2"
        />
      </div>

      <div>
        <span className="block text-sm font-medium">Jurisdictions</span>
        <p className="mt-1 text-xs text-muted">
          Select every jurisdiction your company operates in. A company can
          operate across multiple jurisdictions simultaneously.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          {JURISDICTIONS.map((code) => (
            <label
              key={code}
              className="flex items-center gap-2 rounded border border-line bg-surface px-3 py-2"
            >
              <input
                type="checkbox"
                checked={jurisdictions.includes(code)}
                onChange={() => toggleJurisdiction(code)}
              />
              <span>
                {code} - {JURISDICTION_LABELS[code]}
              </span>
            </label>
          ))}
        </div>
        {jurisdictions.length > 1 && strictestJurisdiction && (
          <p className="mt-2 text-xs text-muted">
            Default compliance timeline will follow{' '}
            <strong>{strictestJurisdiction}</strong>, the strictest of your
            selected jurisdictions, unless overridden per-jurisdiction later.
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="subscription-tier"
          className="block text-sm font-medium"
        >
          Subscription tier
        </label>
        <select
          id="subscription-tier"
          value={subscriptionTier}
          onChange={(e) => setSubscriptionTier(e.target.value)}
          className="field mt-1 w-full rounded px-3 py-2"
        >
          {SUBSCRIPTION_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="block text-sm font-medium">Departments</span>
        <p className="mt-1 text-xs text-muted">
          Departments feed case routing. You can assign a department head
          later.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newDepartmentName}
            onChange={(e) => setNewDepartmentName(e.target.value)}
            placeholder="Department name"
            className="field flex-1 rounded px-3 py-2"
          />
          <button
            type="button"
            onClick={addDepartment}
            className="btn-secondary rounded px-3 py-2"
          >
            Add
          </button>
        </div>
        {departments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {departments.map((dept) => (
              <li
                key={dept.id}
                className="flex items-center justify-between rounded border border-line bg-surface px-3 py-2"
              >
                <span>{dept.name}</span>
                <button
                  type="button"
                  onClick={() => removeDepartment(dept.id)}
                  className="text-sm text-critical"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-critical">{error}</p>}
      {error && companyId && (
        <p className="text-sm text-muted">
          <strong>{name}</strong> was registered, but its Company Admin account
          was not created. Fix the email above and submit again - this will not
          register the company a second time.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={
            submitting ||
            !name.trim() ||
            !adminEmail.trim() ||
            jurisdictions.length === 0
          }
          className="btn-primary rounded px-4 py-2 disabled:opacity-50"
        >
          {submitting
            ? 'Creating...'
            : companyId
              ? 'Create admin account'
              : 'Create company'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="btn-secondary rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export default CompanySetup
