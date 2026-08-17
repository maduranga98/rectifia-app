const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'
const SUPER_ADMINS_COLLECTION = 'superAdmins'

// Super Admin allowlist membership check, same pattern as
// linkCompanySubscription.js's own requireSuperAdmin.
async function requireSuperAdmin(actorUid) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Super Admin to run this migration')
  }
  const snapshot = await admin.firestore().collection(SUPER_ADMINS_COLLECTION).doc(actorUid).get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can run this migration')
  }
}

// One-time migration, Super-Admin-triggerable from the Super Admin
// dashboard: seeds companies/{companyId}.currentEmployeeCount with the real
// count of that company's companies/{companyId}/employees docs, for every
// company that predates addEmployee.js's cap enforcement. Without this,
// every existing company's cap check would start from an assumed 0 instead
// of its actual roster size, silently granting headroom up to a full band's
// cap on top of whoever is already on the roster.
//
// Safe to re-run - it always recomputes from a live count() aggregation
// query rather than incrementing, so running it twice (or against a company
// that already has an accurate currentEmployeeCount) is a no-op in effect.
exports.backfillEmployeeCount = onCall(async (request) => {
  await requireSuperAdmin(request.auth?.uid)

  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()

  let companiesUpdated = 0
  for (const companyDoc of companiesSnapshot.docs) {
    const countSnapshot = await companyDoc.ref.collection(EMPLOYEES_SUBCOLLECTION).count().get()
    await companyDoc.ref.update({ currentEmployeeCount: countSnapshot.data().count })
    companiesUpdated += 1
  }

  return { companiesUpdated }
})
