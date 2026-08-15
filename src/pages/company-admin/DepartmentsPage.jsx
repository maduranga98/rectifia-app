import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createDepartment, getCompany, updateCompanyDepartments } from '../../services/companyService'
import { listStaff } from '../../services/routingService'
import { listEmployees } from '../../services/employeeService'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import Icon from '../../components/ui/Icon'
import { SkeletonList } from '../../components/ui/Loading'

// Departments live as a plain array on companies/{companyId}.departments
// (Module 3's schema - {id, name, headUserId}), not a subcollection, so
// every edit here rewrites the whole array via updateCompanyDepartments.
function DepartmentsPage({ companyId }) {
  const { t } = useTranslation()
  const [company, setCompany] = useState(null)
  const [staff, setStaff] = useState([])
  const [employees, setEmployees] = useState([])
  const [newDeptName, setNewDeptName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [companyData, staffRows, employeeRows] = await Promise.all([
        getCompany(companyId),
        listStaff(companyId),
        listEmployees(companyId),
      ])
      setCompany(companyData)
      setStaff(staffRows)
      setEmployees(employeeRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  async function saveDepartments(departments) {
    setSaving(true)
    try {
      await updateCompanyDepartments(companyId, departments)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddDepartment(e) {
    e.preventDefault()
    if (!newDeptName.trim() || !company) return
    const department = createDepartment({ name: newDeptName.trim() })
    await saveDepartments([...(company.departments ?? []), department])
    setNewDeptName('')
  }

  async function handleRenameDepartment(deptId, name) {
    if (!company || !name.trim()) return
    const updated = (company.departments ?? []).map((d) => (d.id === deptId ? { ...d, name: name.trim() } : d))
    await saveDepartments(updated)
  }

  async function handleSetHead(deptId, headUserId) {
    if (!company) return
    const updated = (company.departments ?? []).map((d) =>
      d.id === deptId ? { ...d, headUserId: headUserId || null } : d
    )
    await saveDepartments(updated)
  }

  async function handleDeleteDepartment(deptId) {
    if (!company) return
    const updated = (company.departments ?? []).filter((d) => d.id !== deptId)
    await saveDepartments(updated)
  }

  const departments = company?.departments ?? []

  // Department identity is a plain string on both sides but they can drift: an
  // employee's `department` (free text from the roster form or a CSV import) is
  // never normalised against this configured list, and pulseSummaries.department
  // carries that same unnormalised string. A manager's pulse scope claim must
  // match that exact string, so a department that exists on employees but not
  // here is invisible to scoping and to routing - surfaced (not rewritten) so
  // the admin can reconcile the two by hand.
  const configuredNames = new Set(departments.map((d) => String(d.name ?? '').trim()))
  const unlistedDepartments = Array.from(
    new Set(
      employees
        .map((e) => String(e.department ?? '').trim())
        .filter((name) => name && !configuredNames.has(name))
    )
  )

  // The add form is duplicated into the empty state on purpose: with no
  // departments there is nothing above it to anchor to, and a lone input
  // under a "No departments yet." line reads as a broken page.
  const addForm = (
    <form onSubmit={handleAddDepartment} className="flex flex-col gap-2 sm:flex-row">
      <input
        aria-label={t('departmentsPage.newDepartmentName')}
        placeholder={t('departmentsPage.newDepartmentPlaceholder')}
        value={newDeptName}
        onChange={(e) => setNewDeptName(e.target.value)}
        className="field sm:max-w-xs"
      />
      <Button type="submit" variant="primary" icon="plus" disabled={!newDeptName.trim() || saving}>
        {t('departmentsPage.addDepartment')}
      </Button>
    </form>
  )

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">{t('departmentsPage.description')}</p>

      {error && <Alert variant="error">{error}</Alert>}

      {unlistedDepartments.length > 0 && (
        <Alert variant="warning" title={t('departmentsPage.unlisted.title')}>
          {t('departmentsPage.unlisted.body1')}{' '}
          <span className="font-medium">{unlistedDepartments.join(', ')}</span>.{' '}
          {t('departmentsPage.unlisted.body2')}
        </Alert>
      )}

      {loading && !company ? (
        <SkeletonList rows={3} />
      ) : (
        <Card
          title={t('adminNav.departments')}
          description={t('departmentsPage.configuredCount', { count: departments.length })}
          padded={false}
          footer={departments.length > 0 ? addForm : undefined}
        >
          {departments.length === 0 ? (
            <EmptyState
              icon="departments"
              title={t('departmentsPage.empty.title')}
              description={t('departmentsPage.empty.description')}
              action={addForm}
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {departments.map((dept) => (
                <li
                  key={dept.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-navy-50/40"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy"
                    aria-hidden="true"
                  >
                    <Icon name="departments" />
                  </span>

                  <input
                    aria-label={t('departmentsPage.departmentNameLabel', { name: dept.name })}
                    defaultValue={dept.name}
                    onBlur={(e) => e.target.value !== dept.name && handleRenameDepartment(dept.id, e.target.value)}
                    className="field w-full font-medium sm:w-56"
                  />

                  <label className="flex items-center gap-2 text-xs text-muted">
                    <span className="whitespace-nowrap">{t('departmentsPage.head')}</span>
                    <select
                      value={dept.headUserId ?? ''}
                      onChange={(e) => handleSetHead(dept.id, e.target.value)}
                      className="field w-full sm:w-56"
                    >
                      <option value="">{t('departmentsPage.notAssigned')}</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.email ?? s.id}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Button
                    variant="dangerGhost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => handleDeleteDepartment(dept.id)}
                    disabled={saving}
                  >
                    {t('departmentsPage.delete')}
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

export default DepartmentsPage
