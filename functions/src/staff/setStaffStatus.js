const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { resolveStaffEffectivePermissions, hasPermission } = require('../utils/permissionResolver')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const ACTION = 'staff_status_change'
const VALID_STATUSES = ['active', 'suspended']

// Suspending a staff member used to be a plain client write of
// `status: 'suspended'` on companies/{companyId}/staff/{staffId} (the old
// routingService.updateStaffStatus). That field is not part of the
// authorization boundary anywhere: firestore.rules reads request.auth.token
// exclusively, and staffAuth.js only ever looked up the staff doc's `role`.
// So a "suspended" account kept a valid Firebase Auth user, kept its
// role/companyId claims, and could sign in and work as before - the roster
// row went grey and nothing else changed.
//
// This callable is the only correct way to flip that status, because
// suspension has to happen where the account actually lives: the Firebase
// Auth user is disabled (blocking new sign-ins outright) and its refresh
// tokens are revoked (killing the sessions already open), and only then is
// the Firestore mirror updated. Reactivation is the exact inverse.
async function requireStaffManager(firestore, request, companyId) {
  const uid = requireAuthUid(request)
  const claimCompanyId = request.auth?.token?.companyId
  if (!claimCompanyId || claimCompanyId !== companyId) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role: null,
      action: ACTION,
      outcome: 'denied:permission-denied',
      detail: 'company_claim_mismatch',
    })
    throw new HttpsError('permission-denied', 'You may only manage staff in your own company')
  }
  const role = await loadCallerRole(firestore, companyId, uid, ACTION)
  // A staffManagement custom-role holder may suspend and reactivate the same
  // as a Company Admin - the same pair firestore.rules' staff update rule
  // allowed before this callable took the write over. Resolved fresh from the
  // customRoles doc, never a cached claim.
  const resolved = role === 'companyAdmin' ? null : await resolveStaffEffectivePermissions(firestore, companyId, uid)
  if (role !== 'companyAdmin' && !hasPermission(resolved, 'staffManagement')) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: ACTION,
      outcome: 'denied:permission-denied',
      detail: 'role_not_staff_manager',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may suspend or reactivate a staff account')
  }
  return { uid, role }
}

exports.setStaffStatus = onCall(async (request) => {
  const firestore = admin.firestore()
  const { companyId, staffId, status } = request.data || {}
  if (!companyId || !staffId) {
    throw new HttpsError('invalid-argument', 'companyId and staffId are required')
  }
  if (!VALID_STATUSES.includes(status)) {
    throw new HttpsError('invalid-argument', 'status must be active or suspended')
  }

  const { uid: actorUid, role: actorRole } = await requireStaffManager(firestore, request, companyId)

  // Nobody flips their own switch: suspending yourself locks the company out
  // of its own admin seat, and reactivating yourself would be meaningless
  // anyway (a suspended caller can no longer authenticate to get here).
  if (staffId === actorUid) {
    throw new HttpsError('failed-precondition', 'You cannot change your own account status')
  }

  const staffRef = firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(staffId)
  const staffSnapshot = await staffRef.get()
  if (!staffSnapshot.exists) {
    throw new HttpsError('not-found', 'No staff record found for this account in this company')
  }
  const staffData = staffSnapshot.data()
  const currentStatus = staffData.status ?? 'active'

  // Same last-admin guard removeStaffMember.js enforces: suspension now
  // actually removes the account's access, so suspending the only remaining
  // active Company Admin would leave the company with no one able to invite,
  // route, or reactivate anyone.
  if (status === 'suspended' && staffData.role === 'companyAdmin' && currentStatus !== 'suspended') {
    const adminSnapshot = await firestore
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(STAFF_SUBCOLLECTION)
      .where('role', '==', 'companyAdmin')
      .get()
    const activeAdminCount = adminSnapshot.docs.filter(
      (d) => (d.data().status ?? 'active') !== 'suspended'
    ).length
    if (activeAdminCount <= 1) {
      throw new HttpsError('failed-precondition', 'Cannot suspend the last active Company Admin')
    }
  }

  let targetRecord
  try {
    targetRecord = await admin.auth().getUser(staffId)
  } catch (err) {
    logger.error('setStaffStatus: getUser failed', { staffId, error: err.message })
    throw new HttpsError('not-found', 'No account found for this staff member')
  }
  // Cross-check the auth claim against the caller's company rather than
  // trusting the staff doc alone - the claim is the authorization boundary
  // everywhere else (same check updateStaffDepartments.js makes).
  if ((targetRecord.customClaims || {}).companyId !== companyId) {
    throw new HttpsError('permission-denied', 'This staff member does not belong to your company')
  }

  const suspending = status === 'suspended'
  if (suspending) {
    // Disable before writing the mirror: if the Firestore write then fails,
    // the account is already locked out and the roster simply looks stale -
    // the safe direction to fail in. `disabled` blocks new sign-ins;
    // revokeRefreshTokens ends the sessions already open, so an admin who
    // suspends someone mid-shift does not have to wait out that account's
    // ~1-hour ID token lifetime.
    await admin.auth().updateUser(staffId, { disabled: true })
    await admin.auth().revokeRefreshTokens(staffId)
  }

  await staffRef.update({
    status,
    statusUpdatedBy: actorUid,
    statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    suspendedAt: suspending ? admin.firestore.FieldValue.serverTimestamp() : null,
  })

  if (!suspending) {
    // Reactivation is the mirror image: the mirror is written first so a
    // failure here leaves the account still locked out rather than re-enabled
    // without a roster row saying so.
    await admin.auth().updateUser(staffId, { disabled: false })
  }

  await logPrivilegedAction(firestore, {
    uid: actorUid,
    companyId,
    role: actorRole,
    action: ACTION,
    outcome: 'granted',
    detail: `${staffId}:${status}`,
  })

  return { success: true, staffId, status }
})
