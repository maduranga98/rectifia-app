import { useCallback, useEffect, useState } from 'react'
import { getCompany } from '../../services/companyService'
import { listCaseHandlers, listRoutingRules, removeRoutingRule, setRoutingRule } from '../../services/routingService'
import { CATEGORIES } from '../../data/categories'

// (category, department) -> Case Handler mappings under
// companies/{companyId}/routingRules, which functions/src/intake/routeCase.js
// (Module 7) reads to auto-assign new cases. Department options come from
// companies/{companyId}.departments (Module 3); handler options are staff
// filtered to role === 'caseHandler'.
function RoutingRulesPage({ companyId }) {
  const [departments, setDepartments] = useState([])
  const [handlers, setHandlers] = useState([])
  const [rules, setRules] = useState([])
  const [ruleForm, setRuleForm] = useState({ category: CATEGORIES[0]?.id ?? '', department: '', caseHandlerId: '' })
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [company, handlerRows, ruleRows] = await Promise.all([
        getCompany(companyId),
        listCaseHandlers(companyId),
        listRoutingRules(companyId),
      ])
      setDepartments(company?.departments ?? [])
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

  useEffect(() => {
    if (!ruleForm.department && departments.length > 0) {
      setRuleForm((f) => ({ ...f, department: departments[0].name }))
    }
  }, [departments, ruleForm.department])

  async function handleSetRule(e) {
    e.preventDefault()
    if (!ruleForm.category || !ruleForm.department || !ruleForm.caseHandlerId) return
    try {
      await setRoutingRule(companyId, {
        category: ruleForm.category,
        department: ruleForm.department,
        caseHandlerId: ruleForm.caseHandlerId,
      })
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

  if (loading && rules.length === 0 && departments.length === 0) {
    return <p className="p-6 text-sm text-muted">Loading...</p>
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold text-charcoal">Routing rules</h2>
      <p className="text-xs text-muted">Maps a case category + department to the Case Handler it routes to.</p>
      {error && <p className="text-sm text-critical">{error}</p>}

      <ul className="flex flex-col gap-2 text-sm">
        {rules.map((rule) => (
          <li key={rule.id} className="flex items-center justify-between rounded border border-line bg-surface px-3 py-2">
            <span>
              {CATEGORIES.find((c) => c.id === rule.category)?.label ?? rule.category} / {rule.department}
            </span>
            <span className="text-xs text-muted">
              {handlers.find((h) => h.id === rule.caseHandlerId)?.email ?? rule.caseHandlerId}
            </span>
            <button type="button" onClick={() => handleRemoveRule(rule)} className="text-xs text-critical underline">
              Remove
            </button>
          </li>
        ))}
        {rules.length === 0 && <li className="text-sm text-muted">No routing rules yet.</li>}
      </ul>

      <form onSubmit={handleSetRule} className="flex flex-wrap gap-2">
        <select
          value={ruleForm.category}
          onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}
          className="field rounded px-2 py-1 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={ruleForm.department}
          onChange={(e) => setRuleForm({ ...ruleForm, department: e.target.value })}
          className="field rounded px-2 py-1 text-sm"
        >
          {departments.length === 0 && (
            <option value="" disabled>
              No departments yet
            </option>
          )}
          {departments.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={ruleForm.caseHandlerId}
          onChange={(e) => setRuleForm({ ...ruleForm, caseHandlerId: e.target.value })}
          className="field rounded px-2 py-1 text-sm"
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
        <button type="submit" className="btn-primary rounded px-4 py-2 text-sm font-medium">
          Save rule
        </button>
      </form>
    </div>
  )
}

export default RoutingRulesPage
