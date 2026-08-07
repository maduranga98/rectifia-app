import { useCallback, useEffect, useState } from 'react'
import {
  listCustomRoles,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  seedDefaultCustomRoles,
} from '../../services/roleService'
import { PERMISSION_MODULES, PERMISSION_MODULE_KEYS } from '../../config/permissionModules'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { Input } from '../ui/Field'
import EmptyState from '../ui/EmptyState'
import { SkeletonList } from '../ui/Loading'

const EMPTY_FORM = { name: '', permissions: [] }

// Company Admin's role composer: named roles built ONLY from
// PERMISSION_MODULE_KEYS (src/config/permissionModules.js). There is no
// checkbox, toggle, or hidden field anywhere in this component for
// caseHandler or hrCoordinator access - those keys do not exist in the
// allowlist this form renders from, so there is nothing here that could be
// checked to grant them, however this component is edited later. The actual
// security boundary is server-side (createCustomRole/updateCustomRole
// re-validate every key, and firestore.rules never trusts a client-composed
// permissions array) - this form only decides what a Company Admin is
// offered to click.
function RoleBuilder({ companyId }) {
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listCustomRoles(companyId)
      setRoles(rows)
      // Lazily seed the 'manager' role's default custom-role template the
      // first time this company has no custom roles at all yet - see
      // seedDefaultCustomRoles' own comment. Safe to call every time the
      // list is empty; it is idempotent per company.
      if (rows.length === 0) {
        await seedDefaultCustomRoles(companyId)
        const seeded = await listCustomRoles(companyId)
        setRoles(seeded)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  function startCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setError(null)
  }

  function startEdit(role) {
    setEditingId(role.id)
    setForm({ name: role.name ?? '', permissions: Array.isArray(role.permissions) ? role.permissions : [] })
    setShowForm(true)
    setError(null)
  }

  function togglePermission(key) {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(key)
        ? current.permissions.filter((p) => p !== key)
        : [...current.permissions, key],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (editingId) {
        await updateCustomRole({ companyId, roleId: editingId, name: form.name, permissions: form.permissions })
      } else {
        await createCustomRole({ companyId, name: form.name, permissions: form.permissions })
      }
      setShowForm(false)
      setForm(EMPTY_FORM)
      setEditingId(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(role) {
    setPendingDeleteId(role.id)
    setError(null)
    try {
      await deleteCustomRole({ companyId, roleId: role.id })
      await refresh()
    } catch (err) {
      // deleteCustomRole throws failed-precondition when staff are still
      // assigned - surfaced here verbatim rather than a generic message, so
      // the admin knows to reassign those staff first instead of guessing
      // why the delete failed.
      setError(err.message)
    } finally {
      setPendingDeleteId(null)
    }
  }

  const createButton = (
    <Button
      variant={showForm ? 'secondary' : 'primary'}
      icon={showForm ? 'close' : 'plus'}
      onClick={() => (showForm ? setShowForm(false) : startCreate())}
    >
      {showForm ? 'Cancel' : 'New custom role'}
    </Button>
  )

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">
          Build named roles from a fixed set of permission modules. Case Handler and HR Coordinator are
          not composable - they are not offered here and cannot be built from these modules.
        </p>
        {createButton}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {showForm && (
        <Card title={editingId ? 'Edit custom role' : 'New custom role'}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Role name"
              required
              placeholder="e.g. Billing Coordinator"
              value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-charcoal">Permission modules</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSION_MODULE_KEYS.map((key) => {
                  const mod = PERMISSION_MODULES[key]
                  const checked = form.permissions.includes(key)
                  return (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                        checked ? 'border-navy bg-navy-50 text-charcoal' : 'border-line-soft text-muted'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePermission(key)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <span className="block font-medium">{mod.label}</span>
                        <span className="block text-xs text-muted">{mod.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <Button
              type="submit"
              variant="primary"
              className="self-start"
              loading={saving}
              loadingLabel="Saving"
              disabled={!form.name.trim() || form.permissions.length === 0}
            >
              {editingId ? 'Save changes' : 'Create role'}
            </Button>
          </form>
        </Card>
      )}

      {loading && roles.length === 0 ? (
        <SkeletonList rows={3} />
      ) : roles.length === 0 ? (
        <EmptyState
          icon="staff"
          title="No custom roles yet"
          description="Create a named role from the permission modules above to assign to staff who aren't Case Handlers or HR Coordinators."
          action={createButton}
        />
      ) : (
        <Card title="Custom roles" description={`${roles.length} role${roles.length === 1 ? '' : 's'}`} padded={false}>
          <ul className="divide-y divide-line-soft">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-col gap-2 px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-medium text-charcoal">{role.name}</p>
                  <Button variant="secondary" size="sm" onClick={() => startEdit(role)}>
                    Edit
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    onClick={() => handleDelete(role)}
                    loading={pendingDeleteId === role.id}
                    loadingLabel="Deleting"
                  >
                    Delete
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(role.permissions ?? []).map((key) => (
                    <Badge key={key} tone="tone-info">
                      {PERMISSION_MODULES[key]?.label ?? key}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default RoleBuilder
