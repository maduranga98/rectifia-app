import { useCallback, useEffect, useState } from 'react'
import { getCompany } from '../../services/companyService'
import { listCaseHandlers, listRoutingRules, removeRoutingRule, setRoutingRule } from '../../services/routingService'
import { CATEGORIES } from '../../data/categories'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import Icon from '../../components/ui/Icon'
import { Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

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
  const [saving, setSaving] = useState(false)

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
    setSaving(true)
    try {
      await setRoutingRule(companyId, {
        category: ruleForm.category,
        department: ruleForm.department,
        caseHandlerId: ruleForm.caseHandlerId,
      })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveRule(rule) {
    setSaving(true)
    try {
      await removeRoutingRule(companyId, rule.category, rule.department)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = Boolean(ruleForm.category && ruleForm.department && ruleForm.caseHandlerId)

  // Prerequisites are stated up front rather than left to be inferred from
  // a select with nothing in it - a rule needs both a department and a Case
  // Handler to exist before it can be written at all.
  const missing = []
  if (departments.length === 0) missing.push('a department')
  if (handlers.length === 0) missing.push('a Case Handler')

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        Each rule maps a case category and department to the Case Handler it should be assigned
        to. New cases are routed automatically the moment they are submitted.
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      {missing.length > 0 && !loading && (
        <Alert variant="warning" title="Routing is not set up yet">
          You need {missing.join(' and ')} before a rule can be saved. Unrouted cases fall back to
          manual assignment.
        </Alert>
      )}

      <Card
        title="Add a rule"
        description="An existing category and department pair is overwritten rather than duplicated."
      >
        <form onSubmit={handleSetRule} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Select
            label="Category"
            value={ruleForm.category}
            onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>

          <Select
            label="Department"
            value={ruleForm.department}
            onChange={(e) => setRuleForm({ ...ruleForm, department: e.target.value })}
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
          </Select>

          <Select
            label="Assign to"
            value={ruleForm.caseHandlerId}
            onChange={(e) => setRuleForm({ ...ruleForm, caseHandlerId: e.target.value })}
          >
            <option value="" disabled>
              {handlers.length === 0 ? 'No Case Handlers yet' : 'Select a Case Handler'}
            </option>
            {handlers.map((h) => (
              <option key={h.id} value={h.id}>
                {h.email ?? h.id}
              </option>
            ))}
          </Select>

          <Button type="submit" variant="primary" icon="plus" disabled={!canSubmit || saving}>
            Save rule
          </Button>
        </form>
      </Card>

      {loading && rules.length === 0 ? (
        <SkeletonList rows={3} />
      ) : (
        <Card title="Active rules" description={`${rules.length} configured`} padded={false}>
          {rules.length === 0 ? (
            <EmptyState
              icon="routing"
              title="No routing rules yet"
              description="Without a matching rule, an incoming case is flagged for manual assignment instead of going straight to a handler."
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-navy-50/40">
                  <Badge tone="tone-info">
                    {CATEGORIES.find((c) => c.id === rule.category)?.label ?? rule.category}
                  </Badge>
                  <span className="text-sm text-muted">{rule.department}</span>

                  <Icon name="chevronRight" className="h-4 w-4 text-subtle" />

                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-charcoal">
                    {handlers.find((h) => h.id === rule.caseHandlerId)?.email ?? rule.caseHandlerId}
                  </span>

                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={() => handleRemoveRule(rule)}
                    disabled={saving}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

export default RoutingRulesPage
