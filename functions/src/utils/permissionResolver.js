// Server-side mirror of src/config/permissionModules.js's allowlist -
// functions and the app are separate deployables (this file is CommonJS,
// the client config is an ES module - see functions/package.json vs.
// package.json), so this cannot import that file across the build boundary
// and instead carries its own copy, the same tradeoff src/constants/roles.js
// documents for firestore.rules. A permission key added to one MUST be added
// to both this file and firestore.rules' customRoles validation, or a
// company-admin write through one surface could create a role a resolver on
// another surface can't account for.
//
// This is the ONLY permission-key allowlist a custom role's `permissions`
// array is ever validated against, here or in firestore.rules. caseHandler
// and hrCoordinator capabilities are structurally absent - there is no key
// here that could ever grant them, independent of anything a client sends.
const PERMISSION_MODULE_KEYS = Object.freeze([
  'departments',
  'staffManagement',
  'routingRules',
  'policyManagement',
  'retentionSettings',
  'billingView',
  'complianceConfig',
  'pulseAggregateView',
])

// The staff-facing fixed roles this module's composable layer sits beside.
// Company Admin is deliberately included here and NOT in
// PERMISSION_MODULE_KEYS: it is one of the fixed values a staff record's
// `role` field may hold, but it is never itself a permission a custom role
// can be built from (see the "Company Admin is not composable" constraint on
// RoleBuilder.jsx). caseHandler and hrCoordinator are fixed for the same
// reason staffAuth.js's HANDLER_ROLES/TRIAGE_ROLES are fixed arrays rather
// than anything permission-driven - their access model (assigned-case-only,
// full-content triage) has no expression as a composable module and must
// never gain one.
const FIXED_SYSTEM_ROLES = Object.freeze(['superAdmin', 'companyAdmin', 'caseHandler', 'hrCoordinator'])

function sanitizePermissions(permissions) {
  if (!Array.isArray(permissions)) return []
  const seen = new Set()
  const result = []
  for (const key of permissions) {
    if (PERMISSION_MODULE_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  return result
}

// Resolves a staff member's effective permission set from an already-loaded
// staff record (or decoded auth token) shape: `{ role, customRoleId }`. A
// staff account holds exactly one of the two - never both, never neither -
// mirroring the same trust boundary every other staff-facing check in this
// app already uses (see staffAuth.js's loadCallerRole): the caller passes in
// whatever `role`/`customRoleId` field the staff doc or token actually
// carries, this function never re-derives it.
//
// Returns either { kind: 'system', systemRole } or
// { kind: 'custom', customRoleId, permissions } - permissions is already
// filtered through the allowlist above, so a caller never needs to re-check
// an individual key against PERMISSION_MODULE_KEYS itself.
function resolveEffectivePermissions({ role, customRoleId, permissions }) {
  const hasFixedRole = typeof role === 'string' && role.length > 0
  const hasCustomRole = typeof customRoleId === 'string' && customRoleId.length > 0

  if (hasFixedRole && hasCustomRole) {
    throw new Error('Staff record has both a fixed role and a customRoleId; exactly one is required')
  }
  if (!hasFixedRole && !hasCustomRole) {
    throw new Error('Staff record has neither a fixed role nor a customRoleId; exactly one is required')
  }

  if (hasFixedRole) {
    return { kind: 'system', systemRole: role }
  }

  return { kind: 'custom', customRoleId, permissions: sanitizePermissions(permissions) }
}

// Loads companies/{companyId}/customRoles/{customRoleId} and returns its
// permissions, re-validated against the allowlist even though
// createCustomRole/updateCustomRole already validated them at write time -
// defense in depth against a doc that reached this shape some other way
// (a console edit, a future writer that forgets the check). Throws if the
// role doc does not exist, which is exactly the state a staff member points
// at if their custom role was deleted without reassignment - see
// deleteCustomRole's block-if-assigned guard for why that should never
// happen, and this throw for what protects the resolver if it does anyway.
async function loadCustomRolePermissions(firestore, companyId, customRoleId) {
  const snapshot = await firestore
    .collection('companies')
    .doc(companyId)
    .collection('customRoles')
    .doc(customRoleId)
    .get()
  if (!snapshot.exists) {
    throw new Error(`Custom role ${customRoleId} does not exist for company ${companyId}`)
  }
  return sanitizePermissions(snapshot.data().permissions)
}

// The full staff-record resolution: loads the staff doc, resolves whether it
// carries a fixed role or a customRoleId, and for a custom role, loads the
// permissions fresh from the customRoles doc rather than trusting anything
// cached on the staff record or an auth token - so editing a custom role's
// permissions takes effect for every staff member holding it immediately,
// without reissuing a token or re-inviting anyone.
async function resolveStaffEffectivePermissions(firestore, companyId, staffId) {
  const snapshot = await firestore
    .collection('companies')
    .doc(companyId)
    .collection('staff')
    .doc(staffId)
    .get()
  if (!snapshot.exists) {
    throw new Error(`No staff record ${staffId} for company ${companyId}`)
  }
  const data = snapshot.data()
  const resolved = resolveEffectivePermissions({ role: data.role, customRoleId: data.customRoleId })
  if (resolved.kind === 'system') return resolved
  const permissions = await loadCustomRolePermissions(firestore, companyId, resolved.customRoleId)
  return { ...resolved, permissions }
}

// True if the resolved permission set includes `key`. A fixed systemRole
// never carries composable permission keys - its access is whatever that
// role's own hardcoded checks grant elsewhere (staffAuth.js, firestore.rules'
// per-role helpers) - so this always returns false for `kind: 'system'`,
// deliberately: a fixed role is not a shortcut into the composable layer.
function hasPermission(resolved, key) {
  return resolved?.kind === 'custom' && Array.isArray(resolved.permissions) && resolved.permissions.includes(key)
}

module.exports = {
  PERMISSION_MODULE_KEYS,
  FIXED_SYSTEM_ROLES,
  sanitizePermissions,
  resolveEffectivePermissions,
  loadCustomRolePermissions,
  resolveStaffEffectivePermissions,
  hasPermission,
}
