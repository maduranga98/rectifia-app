import { useState } from 'react'
import {
  JURISDICTIONS,
  createCompany,
  createDepartment,
  getStrictestJurisdiction,
} from '../../services/companyService'

const SUBSCRIPTION_TIERS = ['starter', 'professional', 'enterprise']

const JURISDICTION_LABELS = {
  EU: 'European Union',
  UK: 'United Kingdom',
  US: 'United States',
  LK: 'Sri Lanka',
}

function CompanySetup({ onCreated }) {
  const [name, setName] = useState('')
  const [jurisdictions, setJurisdictions] = useState([])
  const [subscriptionTier, setSubscriptionTier] = useState(
    SUBSCRIPTION_TIERS[0]
  )
  const [departments, setDepartments] = useState([])
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

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
      const companyId = await createCompany({
        name,
        jurisdictions,
        departments,
        subscriptionTier,
      })
      onCreated?.(companyId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Company setup</h1>

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
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div>
        <span className="block text-sm font-medium">Jurisdictions</span>
        <p className="mt-1 text-xs text-gray-500">
          Select every jurisdiction your company operates in. A company can
          operate across multiple jurisdictions simultaneously.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          {JURISDICTIONS.map((code) => (
            <label
              key={code}
              className="flex items-center gap-2 rounded border border-gray-300 px-3 py-2"
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
          <p className="mt-2 text-xs text-gray-500">
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
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
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
        <p className="mt-1 text-xs text-gray-500">
          Departments feed case routing. You can assign a department head
          later.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newDepartmentName}
            onChange={(e) => setNewDepartmentName(e.target.value)}
            placeholder="Department name"
            className="flex-1 rounded border border-gray-300 px-3 py-2"
          />
          <button
            type="button"
            onClick={addDepartment}
            className="rounded border border-gray-300 px-3 py-2"
          >
            Add
          </button>
        </div>
        {departments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {departments.map((dept) => (
              <li
                key={dept.id}
                className="flex items-center justify-between rounded border border-gray-200 px-3 py-2"
              >
                <span>{dept.name}</span>
                <button
                  type="button"
                  onClick={() => removeDepartment(dept.id)}
                  className="text-sm text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !name || jurisdictions.length === 0}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Creating...' : 'Create company'}
      </button>
    </form>
  )
}

export default CompanySetup
