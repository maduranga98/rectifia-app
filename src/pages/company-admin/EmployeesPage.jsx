import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addEmployee,
  importEmployees,
  isDeliverable,
  listEmployees,
  parseEmployeeCsv,
  removeEmployee,
  updateEmployee,
} from '../../services/employeeService'
import { getCompany } from '../../services/companyService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Input, Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

const CSV_TEMPLATE = 'name,department,email\nEMP-0412,Engineering,\nDana Okoro,People,dana@example.com\n'

function initials(employee) {
  const source = employee.name ?? employee.email ?? employee.id
  return source.slice(0, 2).toUpperCase()
}

// The Pulse Check recipient roster: companies/{companyId}/employees. These are
// NOT staff. Staff (companies/{companyId}/staff, managed on the Staff page)
// are login-having accounts with a role; an employee here has no account, no
// role, and no way to sign in - they exist so module 14's pulse checks have
// someone to go to. The two are kept in separate collections precisely so a
// pulse-check import can never mint something that looks like a staff record.
//
// Email is optional throughout. A company can load its whole headcount before
// it has work addresses; schedulePulseChecks.js still queues an invite for
// those people and marks it awaiting contact info, so nobody silently drops
// off the roster.
function EmployeesPage({ companyId }) {
  const { t } = useTranslation()
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pendingId, setPendingId] = useState(null)

  const [form, setForm] = useState({ name: '', department: '', email: '' })
  const [preview, setPreview] = useState(null)
  const fileInputRef = useRef(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rows, company] = await Promise.all([listEmployees(companyId), getCompany(companyId)])
      setEmployees(rows)
      setDepartments((company?.departments ?? []).map((d) => d.name).filter(Boolean))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  async function handleAdd(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await addEmployee(companyId, form)
      setForm({ name: '', department: '', email: '' })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleFieldChange(employee, field, value) {
    if (value === (employee[field] ?? '')) return
    setPendingId(employee.id)
    setError(null)
    try {
      await updateEmployee(companyId, employee.id, { [field]: value })
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  async function handleRemove(employee) {
    setPendingId(employee.id)
    setError(null)
    try {
      await removeEmployee(companyId, employee.id)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  // Parse and show what the file contains before writing anything - a
  // mis-mapped column caught here is a re-pick of the file, caught after the
  // import it is hundreds of bad rows to clean up by hand.
  async function handleFileChosen(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setNotice(null)
    try {
      const parsed = parseEmployeeCsv(await file.text())
      if (parsed.headerError) {
        setError(parsed.headerError)
        setPreview(null)
      } else {
        setPreview({ ...parsed, fileName: file.name })
      }
    } catch (err) {
      setError(err.message)
    }
  }

  function clearPreview() {
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleConfirmImport() {
    if (!preview?.employees.length) return
    setSaving(true)
    setError(null)
    try {
      const { added, updated } = await importEmployees(companyId, preview.employees)
      setNotice(t('employeesPage.importResult', { count: added, added, updated }))
      clearPreview()
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'employees-template.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const missingContact = employees.filter((employee) => !isDeliverable(employee)).length

  const addForm = (
    <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Input
        label={t('employeesPage.nameOrId')}
        placeholder={t('employeesPage.nameOrIdPlaceholder')}
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        className="sm:w-52"
        required
      />
      <div className="sm:w-48">
        {departments.length > 0 ? (
          <Select
            label={t('adminNav.departments')}
            value={form.department}
            onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
          >
            <option value="">{t('employeesPage.unassigned')}</option>
            {departments.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            label={t('adminNav.departments')}
            placeholder={t('departmentsPage.newDepartmentPlaceholder')}
            value={form.department}
            onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
          />
        )}
      </div>
      <Input
        label={t('employeesPage.emailOptional')}
        type="email"
        placeholder={t('employeesPage.emailPlaceholder')}
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        className="sm:w-56"
      />
      <Button type="submit" variant="primary" icon="plus" disabled={!form.name.trim() || saving}>
        {t('employeesPage.add')}
      </Button>
    </form>
  )

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">{t('employeesPage.description')}</p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card
        title={t('employeesPage.bulkImport.title')}
        description={t('employeesPage.bulkImport.description')}
        actions={
          <Button variant="secondary" size="sm" onClick={downloadTemplate}>
            {t('employeesPage.bulkImport.downloadTemplate')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label={t('employeesPage.bulkImport.csvFileLabel')}
            onChange={handleFileChosen}
            className="field"
          />

          {preview && (
            <div className="flex flex-col gap-2 rounded-lg border border-line-soft bg-navy-50/40 p-4">
              <p className="text-sm text-charcoal">
                <span className="font-medium">{preview.fileName}</span> -{' '}
                {t('employeesPage.bulkImport.readyToImport', {
                  count: preview.employees.length,
                  missing: preview.employees.filter((row) => !row.email).length,
                })}
              </p>
              {preview.errors.length > 0 && (
                <ul className="list-inside list-disc text-xs text-muted">
                  {preview.errors.slice(0, 8).map((issue) => (
                    <li key={issue.lineNumber}>
                      {t('employeesPage.bulkImport.lineError', {
                        line: issue.lineNumber,
                        message: issue.message,
                      })}
                    </li>
                  ))}
                  {preview.errors.length > 8 && (
                    <li>{t('employeesPage.bulkImport.andMore', { count: preview.errors.length - 8 })}</li>
                  )}
                </ul>
              )}
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleConfirmImport}
                  disabled={saving || preview.employees.length === 0}
                >
                  {t('employeesPage.bulkImport.importCount', { count: preview.employees.length })}
                </Button>
                <Button variant="secondary" size="sm" onClick={clearPreview} disabled={saving}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {loading && employees.length === 0 ? (
        <SkeletonList rows={4} />
      ) : (
        <Card
          title={t('adminNav.employees')}
          description={
            missingContact > 0
              ? t('employeesPage.rosterCountMissing', { count: employees.length, missing: missingContact })
              : t('employeesPage.rosterCount', { count: employees.length })
          }
          padded={false}
          footer={employees.length > 0 ? addForm : undefined}
        >
          {employees.length === 0 ? (
            <EmptyState
              icon="staff"
              title={t('employeesPage.empty.title')}
              description={t('employeesPage.empty.description')}
              action={addForm}
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {employees.map((employee) => (
                <li
                  key={employee.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-navy-50/40"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white"
                    aria-hidden="true"
                  >
                    {initials(employee)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-charcoal">{employee.name}</p>
                    <p className="truncate text-xs text-muted">
                      {employee.department ?? t('employeesPage.noDepartment')}
                    </p>
                  </div>

                  <input
                    aria-label={t('employeesPage.emailForLabel', { name: employee.name })}
                    type="email"
                    defaultValue={employee.email ?? ''}
                    placeholder={t('employeesPage.addEmail')}
                    onBlur={(e) => handleFieldChange(employee, 'email', e.target.value)}
                    disabled={pendingId === employee.id}
                    className="field w-full sm:w-56"
                  />

                  {isDeliverable(employee) ? (
                    <Badge tone="tone-low" dot>
                      {t('employeesPage.deliverable')}
                    </Badge>
                  ) : (
                    <Badge tone="tone-info">{t('employeesPage.awaitingContactInfo')}</Badge>
                  )}

                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={() => handleRemove(employee)}
                    disabled={pendingId === employee.id}
                  >
                    {t('employeesPage.remove')}
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

export default EmployeesPage
