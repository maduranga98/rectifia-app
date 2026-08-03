import { useCallback, useEffect, useState } from 'react'
import {
  createDepartment,
  getCompany,
  updateCompanyDepartments,
} from '../../services/companyService'
import {
  listCaseHandlers,
  listRoutingRules,
  listStaff,
  removeRoutingRule,
  setRoutingRule,
} from '../../services/routingService'
import { CATEGORIES } from '../../data/categories'
import { ROLE_LABELS } from '../../constants/roles'
import StaffInvite from './StaffInvite'

// Company Admin settings: departments, staff, routing rules, and a
// read-only subscription/billing view. Deliberately never touches
// cases/{caseId} or caseMetadata/{caseId} - per the module 2 role design,
// Company Admin gets structure and settings only, never case content. There
// is nothing in this file that reads a case, and firestore.rules doesn't
// grant this role a path to either collection even if there were.
function CompanyAdminPanel({ companyId }) {
  const [company, setCompany] = useState(null)
  const [staff, setStaff] = useState([])
  const [handlers, setHandlers] = useState([])
  const [rules, setRules] = useState([])
  const [newDeptName, setNewDeptName] = useState('')
  const [ruleForm, setRuleForm] = useState({ category: CATEGORIES[0]?.id ?? '', department: '', caseHandlerId: '' })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [companyData, staffRows, handlerRows, ruleRows] = await Promise.all([
        getCompany(companyId),
        listStaff(companyId),
        listCaseHandlers(companyId),
        listRoutingRules(companyId),
      ])
      setCompany(companyData)
      setStaff(staffRows)
      setHandlers(handlerRows)
      setRules(ruleRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  async function handleAddDepartment(e) {
    e.preventDefault()
    if (!newDeptName.trim() || !company) return
    try {
      const department = createDepartment({ name: newDeptName.trim() })
      await updateCompanyDepartments(companyId, [...(company.departments ?? []), department])
      setNewDeptName('')
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRenameDepartment(deptId, name) {
    if (!company) return
    try {
      const updated = (company.departments ?? []).map((d) => (d.id === deptId ? { ...d, name } : d))
      await updateCompanyDepartments(companyId, updated)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSetRule(e) {
    e.preventDefault()
    if (!ruleForm.category || !ruleForm.department.trim() || !ruleForm.caseHandlerId) return
    try {
      await setRoutingRule(companyId, {
        category: ruleForm.category,
        department: ruleForm.department.trim(),
        caseHandlerId: ruleForm.caseHandlerId,
      })
      setRuleForm({ ...ruleForm, department: '' })
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRemoveRule(rule) {
    try {
      await removeRoutingRule(companyId, rule.category, rule.department)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading && !company) {
    return <p className="p-6 text-sm text-gray-500">Loading...</p>
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <h1 className="text-xl font-semibold">Company settings</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Departments</h2>
        <ul className="flex flex-col gap-2">
          {(company?.departments ?? []).map((dept) => (
            <li key={dept.id} className="flex items-center gap-2">
              <input
                defaultValue={dept.name}
                onBlur={(e) => e.target.value !== dept.name && handleRenameDepartment(dept.id, e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddDepartment} className="flex gap-2">
          <input
            placeholder="New department name"
            value={newDeptName}
            onChange={(e) => setNewDeptName(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            Add
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Staff</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
              <span>{s.email ?? s.id}</span>
              <span className="text-xs text-gray-500">{ROLE_LABELS[s.role] ?? s.role}</span>
              <span className="text-xs text-gray-400">{s.status ?? 'active'}</span>
            </li>
          ))}
        </ul>
        <StaffInvite companyId={companyId} onInvited={refresh} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Routing rules</h2>
        <p className="text-xs text-gray-500">Maps a case category + department to the Case Handler it routes to.</p>
        <ul className="flex flex-col gap-2 text-sm">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between rounded border border-gray-200 px-3 py-2">
              <span>
                {rule.category} / {rule.department}
              </span>
              <span className="text-xs text-gray-500">
                {handlers.find((h) => h.id === rule.caseHandlerId)?.email ?? rule.caseHandlerId}
              </span>
              <button type="button" onClick={() => handleRemoveRule(rule)} className="text-xs text-red-600 underline">
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleSetRule} className="flex flex-wrap gap-2">
          <select
            value={ruleForm.category}
            onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            placeholder="Department"
            value={ruleForm.department}
            onChange={(e) => setRuleForm({ ...ruleForm, department: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <select
            value={ruleForm.caseHandlerId}
            onChange={(e) => setRuleForm({ ...ruleForm, caseHandlerId: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="" disabled>
              Case Handler...
            </option>
            {handlers.map((h) => (
              <option key={h.id} value={h.id}>
                {h.email ?? h.id}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            Save rule
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Subscription &amp; billing</h2>
        <div className="rounded border border-gray-200 px-4 py-3 text-sm">
          <p>
            Plan: <span className="font-medium">{company?.subscriptionTier ?? 'Not set'}</span>
          </p>
          <p>
            Cases this period: <span className="font-medium">{company?.currentPeriodCaseCount ?? 0}</span>
          </p>
          <p className="mt-2 text-xs text-gray-400">Read-only. Payment and plan changes are handled outside this panel.</p>
        </div>
      </section>
    </div>
  )
}

export default CompanyAdminPanel
