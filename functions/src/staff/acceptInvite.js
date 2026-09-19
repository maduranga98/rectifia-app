const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'

// request.auth.token is a snapshot of the custom claims as they stood when the
// caller's ID token was minted, so a missing companyId does not mean the
// account has no company - it can equally mean the token predates the claim
// being stamped, or was minted by an Auth instance that had not finished
// reading it back. AcceptInvitePage calls this seconds after
// confirmPasswordReset, which is exactly when a client is most likely to be
// holding such a token, and the old code answered that with 'unauthenticated'
// - a 401 that read as "you are not signed in" to a Company Admin who
// demonstrably was.
//
// The stamped claims are authoritative and one getUser() away, so fall back to
// them. This still reads only the caller's own record, keyed by the uid the
// Functions runtime verified, so it grants nothing the token wouldn't have: a
// caller with no companyId claim anywhere is still refused below.
async function resolveCompanyId(uid, tokenCompanyId) {
  if (tokenCompanyId) return tokenCompanyId
  try {
    const userRecord = await admin.auth().getUser(uid)
    return userRecord.customClaims?.companyId ?? null
  } catch {
    return null
  }
}

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
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to accept your invite')
  }

  const companyId = await resolveCompanyId(uid, request.auth?.token?.companyId)
  if (!companyId) {
    // No company on the token and none stamped on the account either - this
    // account was never provisioned as staff, which is a different failure from
    // "not signed in" and deserves to say so rather than sending the client
    // into a token-refresh retry that cannot help.
    throw new HttpsError('failed-precondition', 'This account is not set up as company staff')
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
