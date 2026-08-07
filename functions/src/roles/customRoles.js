const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { PERMISSION_MODULE_KEYS, sanitizePermissions } = require('../utils/permissionResolver')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const CUSTOM_ROLES_SUBCOLLECTION = 'customRoles'
const STAFF_SUBCOLLECTION = 'staff'

async function requireCompanyAdmin(actorUid, companyId) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Company Admin to manage custom roles')
  }
  const actor = await admin.auth().getUser(actorUid)
  const claims = actor.customClaims || {}
  if (claims.role !== 'companyAdmin' || claims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Only a Company Admin for this company can manage custom roles')
  }
}

// Server-side validation is the actual security boundary here, not
// RoleBuilder.jsx's checkbox list - a request that reaches this callable by
// any other path (a modified client, a direct API call) gets the exact same
// allowlist check. `permissions` must be a non-empty array of keys drawn
// ONLY from PERMISSION_MODULE_KEYS; any key outside that list - including
// 'caseHandler' or 'hrCoordinator', which are never in the list at all - is
// rejected outright rather than silently dropped, so a caller learns
// immediately that its request was malformed rather than getting a role with
// fewer permissions than it asked for.
function validatePermissions(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) {
    throw new HttpsError('invalid-argument', 'permissions must be a non-empty array')
  }
  const invalid = permissions.filter((key) => !PERMISSION_MODULE_KEYS.includes(key))
  if (invalid.length > 0) {
    throw new HttpsError(
      'invalid-argument',
      `permissions contains keys outside the allowed set: ${invalid.join(', ')}`
    )
  }
  return sanitizePermissions(permissions)
}

function validateName(name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed || trimmed.length > 100) {
    throw new HttpsError('invalid-argument', 'name must be between 1 and 100 characters')
  }
  return trimmed
}

// Creates a named custom role under companies/{companyId}/customRoles.
// Company Admin only - Company Admin is the composer of this layer, never
// itself a composable role (see the module's own constraint on RoleBuilder).
exports.createCustomRole = onCall(async (request) => {
  const actorUid = request.auth?.uid
  const { companyId, name, permissions } = request.data || {}
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  await requireCompanyAdmin(actorUid, companyId)

  const validName = validateName(name)
  const validPermissions = validatePermissions(permissions)

  const roleRef = admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(CUSTOM_ROLES_SUBCOLLECTION)
    .doc()

  await roleRef.set({
    name: validName,
    permissions: validPermissions,
    createdBy: actorUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { success: true, id: roleRef.id }
})

// Updates an existing custom role's name and/or permission set. Every staff
// member holding this customRoleId resolves their new permissions on their
// very next request - permissionResolver.js reads the customRoles doc fresh
// rather than caching permissions on a claim, deliberately, so an edit here
// takes effect without reissuing anyone's token.
exports.updateCustomRole = onCall(async (request) => {
  const actorUid = request.auth?.uid
  const { companyId, roleId, name, permissions } = request.data || {}
  if (!companyId || !roleId) {
    throw new HttpsError('invalid-argument', 'companyId and roleId are required')
  }
  await requireCompanyAdmin(actorUid, companyId)

  const roleRef = admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(CUSTOM_ROLES_SUBCOLLECTION)
    .doc(roleId)
  const snapshot = await roleRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such custom role')
  }

  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }
  if (name !== undefined) update.name = validateName(name)
  if (permissions !== undefined) update.permissions = validatePermissions(permissions)

  await roleRef.update(update)
  return { success: true }
})

// Deletes a custom role - but only once nobody is pointing at it. A staff
// member whose customRoleId resolves to a doc that no longer exists has an
// unresolvable effective permission set (permissionResolver.js's
// loadCustomRolePermissions throws exactly that), so this callable is the
// one place that guarantee is enforced: it queries staff for this
// customRoleId first and refuses to delete while any are still assigned,
// rather than leaving that to the caller's discipline.
exports.deleteCustomRole = onCall(async (request) => {
  const actorUid = request.auth?.uid
  const { companyId, roleId } = request.data || {}
  if (!companyId || !roleId) {
    throw new HttpsError('invalid-argument', 'companyId and roleId are required')
  }
  await requireCompanyAdmin(actorUid, companyId)

  const firestore = admin.firestore()
  const roleRef = firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(CUSTOM_ROLES_SUBCOLLECTION)
    .doc(roleId)
  const snapshot = await roleRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such custom role')
  }

  const assignedSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .where('customRoleId', '==', roleId)
    .limit(1)
    .get()
  if (!assignedSnapshot.empty) {
    throw new HttpsError(
      'failed-precondition',
      'This role is still assigned to one or more staff members. Reassign them to a different role before deleting it.'
    )
  }

  await roleRef.delete()
  return { success: true }
})

// Migration: the pre-existing fixed 'manager' role (Pulse Check aggregate
// access, department-scoped via the `departments` claim) is converted to a
// default custom-role TEMPLATE on rollout, not deleted - see the
// pulseSummaries rule in firestore.rules, which still honours the legacy
// 'manager' claim completely unchanged. Existing companies keep every
// currently-invited manager's access exactly as it was; nothing about their
// account, claim, or staff doc is touched by this function.
//
// What this callable does is idempotently create ONE starter custom role
// per company - "Pulse Manager", holding just the pulseAggregateView
// permission - so that from rollout onward, a Company Admin inviting a NEW
// person into that kind of access has a composable role available to pick
// (or to duplicate and adjust) instead of the old fixed 'manager' role,
// without any existing manager losing access mid-migration. It is called
// once, lazily, the first time a Company Admin opens RoleBuilder.jsx for a
// company that has no custom roles yet; calling it again for a company that
// already has the template is a no-op.
const DEFAULT_TEMPLATE_NAME = 'Pulse Manager'
const DEFAULT_TEMPLATE_PERMISSIONS = ['pulseAggregateView']

exports.seedDefaultCustomRoles = onCall(async (request) => {
  const actorUid = request.auth?.uid
  const { companyId } = request.data || {}
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  await requireCompanyAdmin(actorUid, companyId)

  const rolesRef = admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(CUSTOM_ROLES_SUBCOLLECTION)

  const existing = await rolesRef.where('name', '==', DEFAULT_TEMPLATE_NAME).limit(1).get()
  if (!existing.empty) {
    return { success: true, seeded: false, id: existing.docs[0].id }
  }

  const roleRef = rolesRef.doc()
  await roleRef.set({
    name: DEFAULT_TEMPLATE_NAME,
    permissions: DEFAULT_TEMPLATE_PERMISSIONS,
    createdBy: actorUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { success: true, seeded: true, id: roleRef.id }
})
