import { useCallback, useEffect, useState } from 'react'
import { createDepartment, getCompany, updateCompanyDepartments } from '../../services/companyService'
import { listStaff } from '../../services/routingService'

// Departments live as a plain array on companies/{companyId}.departments
// (Module 3's schema - {id, name, headUserId}), not a subcollection, so
// every edit here rewrites the whole array via updateCompanyDepartments.
function DepartmentsPage({ companyId }) {
  const [company, setCompany] = useState(null)
  const [staff, setStaff] = useState([])
  const [newDeptName, setNewDeptName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [companyData, staffRows] = await Promise.all([getCompany(companyId), listStaff(companyId)])
      setCompany(companyData)
      setStaff(staffRows)
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
    try {
      await updateCompanyDepartments(companyId, departments)
      await refresh()
    } catch (err) {
      setError(err.message)
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

  if (loading && !company) {
    return <p className="p-6 text-sm text-muted">Loading...</p>
  }

  const departments = company?.departments ?? []

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold text-charcoal">Departments</h2>
      {error && <p className="text-sm text-critical">{error}</p>}

      <ul className="flex flex-col gap-2">
        {departments.map((dept) => (
          <li key={dept.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-surface px-3 py-2">
            <input
              defaultValue={dept.name}
              onBlur={(e) => e.target.value !== dept.name && handleRenameDepartment(dept.id, e.target.value)}
              className="field rounded px-2 py-1 text-sm"
            />
            <select
              value={dept.headUserId ?? ''}
              onChange={(e) => handleSetHead(dept.id, e.target.value)}
              className="field rounded px-2 py-1 text-sm"
            >
              <option value="">No head assigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.email ?? s.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handleDeleteDepartment(dept.id)}
              className="ml-auto text-xs text-critical underline"
            >
              Delete
            </button>
          </li>
        ))}
        {departments.length === 0 && <li className="text-sm text-muted">No departments yet.</li>}
      </ul>

      <form onSubmit={handleAddDepartment} className="flex gap-2">
        <input
          placeholder="New department name"
          value={newDeptName}
          onChange={(e) => setNewDeptName(e.target.value)}
          className="field rounded px-3 py-2 text-sm"
        />
        <button type="submit" className="btn-primary rounded px-4 py-2 text-sm font-medium">
          Add
        </button>
      </form>
    </div>
  )
}

export default DepartmentsPage
