import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCompany } from '../../services/companyService'
import {
  listCaseHandlers,
  listCasesMissingRoutingRule,
  listRoutingRules,
  reassignCase,
  removeRoutingRule,
  setRoutingRule,
} from '../../services/routingService'
import { auth } from '../../services/firebase'
import { CATEGORIES } from '../../data/categories'
import CaseTriageModal from '../../components/dashboard/CaseTriageModal'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import Icon from '../../components/ui/Icon'
import { Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
}

function formatDate(value) {
  const ms = value?.toMillis?.() ?? (typeof value === 'number' ? value : null)
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// (category, department) -> Case Handler mappings under
// companies/{companyId}/routingRules, which functions/src/intake/routeCase.js
// (Module 7) reads to auto-assign new cases. Department options come from
// companies/{companyId}.departments (Module 3); handler options are staff
// filtered to role === 'caseHandler'.
//
// The "Needs attention" section below is the company-side half of manual
// assignment: cases routeCase.js parked on 'no_routing_rule' - a gap in the
// configuration on this very page - rather than something the platform
// operator should be assigning by hand. It reads caseMetadata/{caseId} and
// shows only caseId, category, department, priority and the submission date;
// firestore.rules gives this role no read path to cases/, messages/, or
// questionnaire responses, and none to conflict-of-interest cases either -
// those stay with the Super Admin, since a Company Admin is exactly who the
// conflict check may have flagged.
function RoutingRulesPage({ companyId }) {
  const [departments, setDepartments] = useState([])
  const [handlers, setHandlers] = useState([])
  const [rules, setRules] = useState([])
  const [unroutedCases, setUnroutedCases] = useState([])
  const [ruleForm, setRuleForm] = useState({ category: CATEGORIES[0]?.id ?? '', department: '', caseHandlerId: '' })
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [assigningCaseId, setAssigningCaseId] = useState(null)
  const [triageCaseId, setTriageCaseId] = useState(null)
  const ruleFormRef = useRef(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [company, handlerRows, ruleRows, unroutedRows] = await Promise.all([
        getCompany(companyId),
        listCaseHandlers(companyId),
        listRoutingRules(companyId),
        listCasesMissingRoutingRule(companyId),
      ])
      setDepartments(company?.departments ?? [])
      setHandlers(handlerRows)
      setRules(ruleRows)
      setUnroutedCases(unroutedRows)
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

  // A stuck case can carry a department the company no longer lists - or
  // 'unspecified', the bucket routeCase.js falls back to when no department
  // was captured. Pre-filling the form with one of those has to add it as an
  // option, or the select silently drops the value and the rule that gets
  // written is not the one the button promised.
  const departmentOptions = useMemo(() => {
    const names = departments.map((d) => d.name)
    return ruleForm.department && !names.includes(ruleForm.department)
      ? [...names, ruleForm.department]
      : names
  }, [departments, ruleForm.department])

  // (a) Fix the gap: pre-fill the rule form with this case's bucket so the
  // next case like it routes on its own. Existing stuck cases are not
  // retroactively routed by saving a rule - routeCase.js runs at scoring time
  // - so the case itself still needs assigning, which the copy says plainly.
  function handleConfigureRule(caseRow) {
    setNotice(null)
    setRuleForm({
      category: caseRow.category ?? CATEGORIES[0]?.id ?? '',
      department: caseRow.department ?? 'unspecified',
      caseHandlerId: '',
    })
    ruleFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // (b) Deal with this one case now, through the same reassignCase callable
  // the HR Coordinator dashboard uses - cases/{caseId} is not client-writable,
  // so there is no second assignment path to maintain.
  async function handleAssignCase(caseRow, handlerId) {
    if (!handlerId) return
    setAssigningCaseId(caseRow.caseId)
    setError(null)
    setNotice(null)
    try {
      await reassignCase({
        caseId: caseRow.caseId,
        companyId,
        handlerId,
        actorId: auth.currentUser?.uid,
      })
      setNotice(`Case ${caseRow.caseId} assigned.`)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setAssigningCaseId(null)
    }
  }

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
      setNotice('Rule saved. Cases submitted from now on route to that handler automatically.')
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
      {notice && <Alert variant="success">{notice}</Alert>}

      {unroutedCases.length > 0 && (
        <Card
          title="Needs attention"
          description={`${unroutedCases.length} case${
            unroutedCases.length === 1 ? '' : 's'
          } waiting because no rule covered it`}
          padded={false}
        >
          <p className="border-b border-line-soft px-5 py-3 text-xs text-muted">
            Configure the missing rule so future cases in that bucket route on their own, or assign
            this case to a handler now. Saving a rule does not place cases already waiting here.
            Nothing on this page shows what a report says - only where it should go.
          </p>
          <ul className="divide-y divide-line-soft">
            {unroutedCases.map((caseRow) => (
              <li key={caseRow.caseId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold text-charcoal">{caseRow.caseId}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>
                      {CATEGORIES.find((c) => c.id === caseRow.category)?.label ??
                        caseRow.category ??
                        'Uncategorized'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{caseRow.department ?? 'unspecified'}</span>
                    <span aria-hidden="true">·</span>
                    <span>Submitted {formatDate(caseRow.createdAt)}</span>
                  </p>
                </div>

                {caseRow.priority && (
                  <Badge tone={PRIORITY_TONE[caseRow.priority] ?? 'tone-neutral'} dot>
                    {caseRow.priority}
                  </Badge>
                )}

                {/* (c) Read the report before placing it. Every row in this
                    list is unassigned and parked on 'no_routing_rule' - never
                    a conflict-of-interest case, which this role has no read
                    path to at all - so all of them are triageable. The modal,
                    not this page, is the only place case content appears:
                    the list itself is still fed by the metadata-only
                    caseMetadata mirror. */}
                <Button
                  variant="secondary"
                  size="sm"
                  icon="document"
                  onClick={() => setTriageCaseId(caseRow.caseId)}
                >
                  View
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  icon="routing"
                  onClick={() => handleConfigureRule(caseRow)}
                >
                  Configure rule
                </Button>

                <select
                  aria-label={`Assign case ${caseRow.caseId}`}
                  className="field w-44 py-1 text-xs"
                  value=""
                  disabled={assigningCaseId === caseRow.caseId || handlers.length === 0}
                  onChange={(e) => handleAssignCase(caseRow, e.target.value)}
                >
                  <option value="" disabled>
                    {assigningCaseId === caseRow.caseId
                      ? 'Assigning...'
                      : handlers.length === 0
                        ? 'No Case Handlers yet'
                        : 'Assign to...'}
                  </option>
                  {handlers.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.email ?? h.id}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {missing.length > 0 && !loading && (
        <Alert variant="warning" title="Routing is not set up yet">
          You need {missing.join(' and ')} before a rule can be saved. Unrouted cases fall back to
          manual assignment.
        </Alert>
      )}

      {/* The ref lives on a wrapper rather than on Card so "Configure rule"
          can scroll the form into view without Card having to forward it. */}
      <div ref={ruleFormRef}>
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
              {departmentOptions.length === 0 && (
                <option value="" disabled>
                  No departments yet
                </option>
              )}
              {departmentOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
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
      </div>

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

      {triageCaseId && (
        <CaseTriageModal
          caseId={triageCaseId}
          companyId={companyId}
          onClose={() => setTriageCaseId(null)}
          onAssigned={(caseId) => {
            setNotice(`Case ${caseId} assigned.`)
            refresh()
          }}
        />
      )}
    </div>
  )
}

export default RoutingRulesPage
