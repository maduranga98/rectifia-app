const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'

// Flips an invited staff doc to 'active' once the invitee has set their
// password (AcceptInvitePage) and signed in. Trusts request.auth for the
// uid/companyId - the same custom claims stamped by inviteStaff.js - so a
// staff member can only ever activate their own doc, never anyone else's.
//
// It deliberately does NOT re-stamp custom claims: role, companyId and (for a
// manager) the `departments` scope are set once by inviteStaff.js and must
// survive acceptance untouched. Re-issuing claims here would risk dropping the
// departments claim and silently un-scoping a manager, so acceptance only ever
// touches the staff doc's status.
exports.acceptInvite = onCall(async (request) => {
  const uid = request.auth?.uid
  const companyId = request.auth?.token?.companyId
  if (!uid || !companyId) {
    throw new HttpsError('unauthenticated', 'Sign in to accept your invite')
  }

  const staffRef = admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(uid)

  const staffSnapshot = await staffRef.get()
  if (!staffSnapshot.exists) {
    throw new HttpsError('not-found', 'No staff record found for this account')
  }
  if (staffSnapshot.data().status !== 'invited') {
    return { success: true, alreadyActive: true }
  }

  await staffRef.update({
    status: 'active',
    acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { success: true }
})
