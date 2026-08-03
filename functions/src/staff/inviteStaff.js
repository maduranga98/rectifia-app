const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Must stay in lockstep with ROLES in src/constants/roles.js and the role
// checks in firestore.rules - a role added there needs adding here too.
const VALID_ROLES = ['companyAdmin', 'hrCoordinator', 'caseHandler', 'manager', 'pulseCheckReviewer']

async function requireCompanyAdmin(actorUid, companyId) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Company Admin to invite staff')
  }
  const actor = await admin.auth().getUser(actorUid)
  const claims = actor.customClaims || {}
  if (claims.role !== 'companyAdmin' || claims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Only a Company Admin for this company can invite staff')
  }
}

// Invites a new staff member: creates their Firebase Auth account (random
// password the invitee never sees), stamps the role + companyId as custom
// claims (the only thing firestore.rules trusts for role checks - never a
// Firestore field), creates the staff doc, and queues a password-reset-style
// link so they set their own password on first login. Actual email delivery
// is out of scope here (same "queue metadata, deliver elsewhere" pattern
// routeCase.js and checkOverdueDeadlines.js already use for notifications) -
// this just writes the notifications doc the delivery module reads.
exports.inviteStaff = onCall(async (request) => {
  const { companyId, email, role, actorId } = request.data || {}
  if (!companyId || !email || !role) {
    throw new HttpsError('invalid-argument', 'companyId, email, and role are required')
  }
  if (!VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of ${VALID_ROLES.join(', ')}`)
  }

  await requireCompanyAdmin(actorId ?? request.auth?.uid, companyId)

  const companySnapshot = await admin.firestore().collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'No such company')
  }

  const temporaryPassword = admin.firestore().collection('_').doc().id + 'Aa1!'

  let userRecord
  try {
    userRecord = await admin.auth().createUser({ email, password: temporaryPassword })
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'A staff account with this email already exists')
    }
    logger.error('inviteStaff: createUser failed', { email, error: err.message })
    throw new HttpsError('internal', 'Could not create the staff account')
  }

  await admin.auth().setCustomUserClaims(userRecord.uid, { role, companyId })

  await admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(userRecord.uid)
    .set({
      email,
      role,
      status: 'invited',
      invitedBy: actorId ?? request.auth?.uid ?? null,
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

  const inviteLink = await admin.auth().generatePasswordResetLink(email)

  await admin.firestore().collection(NOTIFICATIONS_COLLECTION).add({
    type: 'staffInvite',
    companyId,
    staffId: userRecord.uid,
    recipientEmail: email,
    role,
    inviteLink,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
  })

  return { success: true, staffId: userRecord.uid }
})
