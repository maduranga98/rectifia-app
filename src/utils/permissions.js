// Client-side mirror of functions/src/utils/permissionResolver.js's
// resolveEffectivePermissions/hasPermission - the same "can't literally
// share this file" tradeoff src/constants/roles.js documents for
// firestore.rules: that module is CommonJS and calls the Admin SDK, so it
// cannot be imported into this Vite/ESM bundle, and this file carries its
// own copy of the same algorithm instead.
//
// This is a read model for the UI (ProtectedRoute, nav filtering) - never
// itself a security boundary. The actual boundary is firestore.rules'
// hasCustomPermission() (reads the customRoles doc fresh on every request)
// and every Cloud Function that calls resolveStaffEffectivePermissions
// server-side; a value this file computes wrong can misroute a signed-in
// user's UI, never grant them a read or write rules/functions would refuse.
import { PERMISSION_MODULE_KEYS } from '../config/permissionModules'

// Resolves { role, customRoleId, permissions } (AuthContext's shape, already
// loaded from the ID token claim plus - for a customRoleId holder - the
// customRoles doc) into the same { kind: 'system' | 'custom', ... } shape
// permissionResolver.js returns server-side.
export function resolveEffectivePermissions({ role, customRoleId, permissions }) {
  const hasFixedRole = typeof role === 'string' && role.length > 0
  const hasCustomRole = typeof customRoleId === 'string' && customRoleId.length > 0

  if (hasFixedRole && hasCustomRole) {
    return { kind: 'invalid' }
  }
  if (!hasFixedRole && !hasCustomRole) {
    return { kind: 'invalid' }
  }
  if (hasFixedRole) {
    return { kind: 'system', systemRole: role }
  }
  return {
    kind: 'custom',
    customRoleId,
    permissions: Array.isArray(permissions) ? permissions.filter((key) => PERMISSION_MODULE_KEYS.includes(key)) : [],
  }
}

// True if the resolved permission set includes `key`. A fixed systemRole
// never carries composable permission keys, same as the server-side
// hasPermission - its access is whatever that role's own hardcoded checks
// grant elsewhere.
export function hasPermission(resolved, key) {
  return resolved?.kind === 'custom' && resolved.permissions.includes(key)
}
