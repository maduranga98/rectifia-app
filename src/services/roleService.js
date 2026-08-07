import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, firestore, functions } from './firebase'
import { sanitizePermissionKeys } from '../config/permissionModules'

const createCustomRoleCallable = httpsCallable(functions, 'createCustomRole')
const updateCustomRoleCallable = httpsCallable(functions, 'updateCustomRole')
const deleteCustomRoleCallable = httpsCallable(functions, 'deleteCustomRole')
const assignStaffRoleCallable = httpsCallable(functions, 'assignStaffRole')
const seedDefaultCustomRolesCallable = httpsCallable(functions, 'seedDefaultCustomRoles')

// Reads companies/{companyId}/customRoles directly - firestore.rules opens
// this collection to any staff of the company (read-only; every write goes
// through the callables below, with the Admin SDK, so a delete can check no
// staff member is still assigned before it happens - see
// functions/src/roles/customRoles.js).
export async function listCustomRoles(companyId) {
  const snapshot = await getDocs(
    query(collection(firestore, 'companies', companyId, 'customRoles'), orderBy('name'))
  )
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// Creates a named custom role from a subset of PERMISSION_MODULE_KEYS.
// RoleBuilder.jsx's checkbox list can only ever produce keys from that
// allowlist, but this is never the security boundary - createCustomRole
// re-validates every key server-side regardless of what this function sends.
export async function createCustomRole({ companyId, name, permissions }) {
  const validPermissions = sanitizePermissionKeys(permissions)
  if (!companyId || !name?.trim() || validPermissions.length === 0) {
    throw new Error('companyId, name, and at least one permission are required')
  }
  const result = await createCustomRoleCallable({ companyId, name: name.trim(), permissions: validPermissions })
  return result.data
}

export async function updateCustomRole({ companyId, roleId, name, permissions }) {
  if (!companyId || !roleId) {
    throw new Error('companyId and roleId are required')
  }
  const result = await updateCustomRoleCallable({
    companyId,
    roleId,
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(permissions !== undefined ? { permissions: sanitizePermissionKeys(permissions) } : {}),
  })
  return result.data
}

// Deletion is blocked server-side while any staff member is still assigned
// this role - see deleteCustomRole's assignment check. This surfaces that
// failure to the caller as an ordinary thrown Error, same as every other
// callable wrapper in this file.
export async function deleteCustomRole({ companyId, roleId }) {
  if (!companyId || !roleId) {
    throw new Error('companyId and roleId are required')
  }
  const result = await deleteCustomRoleCallable({ companyId, roleId })
  return result.data
}

// Re-assigns an existing staff member to a different fixed role or a
// different custom role. Exactly one of role / customRoleId must be given -
// see assignStaffRole.js for why claims are replaced wholesale rather than
// merged. Forces the caller's own token to refresh too, in case they just
// reassigned themselves (a Company Admin moving off companyAdmin is refused
// server-side, but a staffManagement custom-role holder editing their own
// row is not, so this keeps the local session consistent either way).
export async function assignStaffRole({ companyId, staffId, role, customRoleId }) {
  if (!companyId || !staffId) {
    throw new Error('companyId and staffId are required')
  }
  const result = await assignStaffRoleCallable({ companyId, staffId, role, customRoleId })
  if (auth.currentUser) {
    await auth.currentUser.getIdToken(true)
  }
  return result.data
}

// Idempotently creates the "Pulse Manager" starter template the first time a
// Company Admin opens RoleBuilder for a company with no custom roles yet -
// see seedDefaultCustomRoles' own comment for why this exists (the 'manager'
// migration) and why it is safe to call more than once.
export async function seedDefaultCustomRoles(companyId) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  const result = await seedDefaultCustomRolesCallable({ companyId })
  return result.data
}
