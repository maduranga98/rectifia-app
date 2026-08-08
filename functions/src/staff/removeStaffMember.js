const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const CASES_COLLECTION = 'cases'
const CLOSED_STATUS = 'closed'

// Same actor check assignStaffRole.js uses (functions/src/roles/assignStaffRole.js:21)
// - only a Company Admin for this company may remove a staff member.
async function requireCompanyAdmin(actorUid, companyId) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Company Admin to remove a staff member')
  }
  const actor = await admin.auth().getUser(actorUid)
  const claims = actor.customClaims || {}
  if (claims.role !== 'companyAdmin' || claims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Only a Company Admin for this company can remove a staff member')
  }
}

// Deletes a staff account rather than just their Firestore record. A bare
// client-side `deleteDoc` on companies/{companyId}/staff/{staffId} - which
// firestore.rules' `allow delete: if isCompanyAdmin(companyId)` predicate
// technically permits - would remove the roster row while leaving the
// Firebase Auth user and their custom claims (role/customRoleId/companyId)
// fully intact, so the account keeps authenticating and keeps passing every
// rule that checks request.auth.token rather than the staff doc. This
// callable is the only correct way to remove someone, in this order:
// authorize, refuse if they're the last active Company Admin, refuse if
// they're still the assigned handler on any open case, clear their claims,
// revoke their refresh tokens, then delete the staff doc - so an account
// removed here is actually gone, not just invisible on the roster.
exports.removeStaffMember = onCall(async (request) => {
  const actorUid = request.auth?.uid
  const { companyId, staffId } = request.data || {}
  if (!companyId || !staffId) {
    throw new HttpsError('invalid-argument', 'companyId and staffId are required')
  }

  await requireCompanyAdmin(actorUid, companyId)

  const firestore = admin.firestore()
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

  if (staffData.role === 'companyAdmin' && (staffData.status ?? 'active') !== 'suspended') {
    const activeAdminSnapshot = await firestore
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(STAFF_SUBCOLLECTION)
      .where('role', '==', 'companyAdmin')
      .get()
    const activeAdminCount = activeAdminSnapshot.docs.filter(
      (d) => (d.data().status ?? 'active') !== 'suspended'
    ).length
    if (activeAdminCount <= 1) {
      throw new HttpsError('failed-precondition', 'Cannot remove the last active Company Admin')
    }
  }

  const assignedCasesSnapshot = await firestore
    .collection(CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('assignedHandlerId', '==', staffId)
    .get()
  const openCaseCount = assignedCasesSnapshot.docs.filter((d) => d.data().status !== CLOSED_STATUS).length
  if (openCaseCount > 0) {
    throw new HttpsError(
      'failed-precondition',
      `This staff member is still assigned to ${openCaseCount} open case${openCaseCount === 1 ? '' : 's'}. Reassign ${
        openCaseCount === 1 ? 'it' : 'them'
      } to another handler before removing this account.`,
      { openCaseCount }
    )
  }

  try {
    await admin.auth().setCustomUserClaims(staffId, null)
  } catch (err) {
    logger.error('removeStaffMember: setCustomUserClaims failed', { staffId, error: err.message })
    throw new HttpsError('not-found', 'No account found for this staff member')
  }
  await admin.auth().revokeRefreshTokens(staffId)

  await staffRef.delete()

  return { success: true, staffId }
})
