const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const CUSTOM_ROLES_SUBCOLLECTION = 'customRoles'
const CASES_COLLECTION = 'cases'
const CLOSED_STATUS = 'closed'
const CASE_HANDLER_ROLE = 'caseHandler'

// Company Admin itself is not assignable through this callable - it is
// issued only by createCompanyAdmin.js at company setup, never re-assigned
// to an existing staff member. Manager and Pulse Check Reviewer are the two
// pre-existing fixed roles this module does not touch (see the 'manager'
// migration note in customRoles.js's default-template seed); they stay
// assignable here for backward compatibility with existing invite flows.
const ASSIGNABLE_FIXED_ROLES = ['caseHandler', 'hrCoordinator', 'manager', 'pulseCheckReviewer']

async function requireCompanyAdmin(actorUid, companyId) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Company Admin to change a staff member\'s role')
  }
  const actor = await admin.auth().getUser(actorUid)
  const claims = actor.customClaims || {}
  if (claims.role !== 'companyAdmin' || claims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Only a Company Admin for this company can change a staff member\'s role')
  }
}

// Re-assigns an existing staff member to a different fixed role or a
// different custom role. Exactly one of `role` / `customRoleId` must be
// given - the same "never both, never neither" invariant
// permissionResolver.resolveEffectivePermissions enforces when reading a
// staff record back applies here on write, so a staff record can never even
// transiently hold both fields.
//
// Custom claims are replaced wholesale (companyId plus exactly one of
// role/customRoleId), never merged with the previous claims object - a
// staff member moving from a fixed role to a custom role (or back) must not
// carry over a stale `role`, `customRoleId`, or `departments` claim from
// whatever they held before.
exports.assignStaffRole = onCall(async (request) => {
  const actorUid = request.auth?.uid
  const { companyId, staffId, role, customRoleId } = request.data || {}
  if (!companyId || !staffId) {
    throw new HttpsError('invalid-argument', 'companyId and staffId are required')
  }
  if (role && customRoleId) {
    throw new HttpsError('invalid-argument', 'Provide either role or customRoleId, not both')
  }
  if (!role && !customRoleId) {
    throw new HttpsError('invalid-argument', 'Provide either role or customRoleId')
  }
  if (role && !ASSIGNABLE_FIXED_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of ${ASSIGNABLE_FIXED_ROLES.join(', ')}`)
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

  // Moving someone OUT of caseHandler must not silently orphan an open case
  // they're still assigned to - listCaseHandlers() (src/services/routingService.js)
  // filters strictly on role === 'caseHandler' at read time, so a case whose
  // assignedHandlerId points at a former handler becomes invisible to normal
  // reassignment flows. Same query shape and openCaseCount logic as
  // removeStaffMember.js's equivalent guard.
  const movingOutOfCaseHandler =
    staffData.role === CASE_HANDLER_ROLE && (customRoleId || role !== CASE_HANDLER_ROLE)
  if (movingOutOfCaseHandler) {
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
        } to another handler before changing this person's role.`,
        { openCaseCount }
      )
    }
  }

  if (customRoleId) {
    const roleSnapshot = await firestore
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(CUSTOM_ROLES_SUBCOLLECTION)
      .doc(customRoleId)
      .get()
    if (!roleSnapshot.exists) {
      throw new HttpsError('not-found', 'No such custom role')
    }
  }

  let targetRecord
  try {
    targetRecord = await admin.auth().getUser(staffId)
  } catch (err) {
    logger.error('assignStaffRole: getUser failed', { staffId, error: err.message })
    throw new HttpsError('not-found', 'No account found for this staff member')
  }
  const existingClaims = targetRecord.customClaims || {}
  if (existingClaims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'This staff member does not belong to your company')
  }

  const newClaims = role ? { role, companyId } : { customRoleId, companyId }
  await admin.auth().setCustomUserClaims(staffId, newClaims)

  const staffUpdate = role
    ? {
        role,
        customRoleId: admin.firestore.FieldValue.delete(),
        departments: admin.firestore.FieldValue.delete(),
      }
    : {
        customRoleId,
        role: admin.firestore.FieldValue.delete(),
        departments: admin.firestore.FieldValue.delete(),
      }
  await staffRef.update({
    ...staffUpdate,
    roleUpdatedBy: actorUid,
    roleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  await admin.auth().revokeRefreshTokens(staffId)

  return { success: true, staffId, ...(role ? { role } : { customRoleId }) }
})

exports.ASSIGNABLE_FIXED_ROLES = ASSIGNABLE_FIXED_ROLES
