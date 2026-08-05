const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'

// Same normalisation inviteStaff.js applies: trimmed department *names*, empties
// dropped, de-duplicated. The claim stores the exact string form
// pulseSummaries.department carries (an unnormalised employee/CSV name), because
// the pulseSummaries rule compares the two directly - so this must not lowercase,
// slugify or otherwise rewrite what it is given.
function normalizeDepartments(departments) {
  if (!Array.isArray(departments)) return []
  const seen = new Set()
  const result = []
  for (const value of departments) {
    const name = String(value ?? '').trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

async function requireCompanyAdmin(actorUid, companyId) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Company Admin to update staff departments')
  }
  const actor = await admin.auth().getUser(actorUid)
  const claims = actor.customClaims || {}
  if (claims.role !== 'companyAdmin' || claims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Only a Company Admin for this company can update staff departments')
  }
}

// Sets (or clears) the `departments` scope claim on an existing staff member
// without re-inviting them. This is the only migration path for managers who
// predate the claim - they were stamped with just role + companyId, so their
// pulse dashboard currently sees nothing (fail-closed) until a Company Admin
// assigns departments here.
//
// Only a Company Admin for the same company may call this. The target's other
// claims (role, companyId) are read back and preserved - setCustomUserClaims
// replaces the whole claim object, so merging is mandatory or the role/company
// scope would be wiped. A staff doc mirror is updated for the Staff page's
// display; it is never read for authorization (firestore.rules reads
// request.auth.token exclusively).
//
// A claim change only surfaces on the target's next ID token refresh (Firebase
// refreshes ID tokens about hourly, and the SDK re-fetches on demand). Revoking
// their refresh tokens forces that refresh to happen on the manager's very next
// authenticated request instead of leaving them on a stale, un-scoped claim.
exports.updateStaffDepartments = onCall(async (request) => {
  const { companyId, staffId, departments } = request.data || {}
  if (!companyId || !staffId) {
    throw new HttpsError('invalid-argument', 'companyId and staffId are required')
  }

  await requireCompanyAdmin(request.auth?.uid, companyId)

  const staffRef = admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(staffId)

  const staffSnapshot = await staffRef.get()
  if (!staffSnapshot.exists) {
    throw new HttpsError('not-found', 'No staff record found for this account in this company')
  }

  let targetRecord
  try {
    targetRecord = await admin.auth().getUser(staffId)
  } catch (err) {
    logger.error('updateStaffDepartments: getUser failed', { staffId, error: err.message })
    throw new HttpsError('not-found', 'No account found for this staff member')
  }

  const existingClaims = targetRecord.customClaims || {}
  // Cross-check the auth claim against the staff doc's company rather than
  // trusting the doc alone: the claim is the authorization boundary everywhere
  // else, so a mismatch means this staff member does not belong to the company
  // the caller administers and must not be re-scoped by them.
  if (existingClaims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'This staff member does not belong to your company')
  }

  const normalized = normalizeDepartments(departments)

  await admin.auth().setCustomUserClaims(staffId, {
    ...existingClaims,
    departments: normalized,
  })

  await staffRef.update({
    departments: normalized,
    departmentsUpdatedBy: request.auth?.uid ?? null,
    departmentsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Force the new claim to take effect promptly instead of on the token's own
  // hourly cycle - the manager picks it up on their next request.
  await admin.auth().revokeRefreshTokens(staffId)

  return { success: true, staffId, departments: normalized }
})
