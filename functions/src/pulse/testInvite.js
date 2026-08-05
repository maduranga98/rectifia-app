const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid } = require('../utils/staffAuth')
const { createPulseInvite } = require('../intake/pulseInvites')
const { activeQuestionSetVersion } = require('./questionSet')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

// The three roles with a legitimate reason to see what employees actually
// receive: the Company Admin who edits the questionnaire, and the two roles who
// read the answers and should know what was asked. A manager is deliberately
// absent - they never see individual responses, so there is nothing for them to
// preview from.
const TEST_INVITE_ROLES = ['companyAdmin', 'hrCoordinator', 'pulseCheckReviewer']

// How long a test link stays live. A test is a one-off, not a cadence, so it
// gets its own short window rather than borrowing the company's cadence: a
// stale test link sitting in an inbox for a month is a support question waiting
// to happen.
const TEST_INVITE_DAYS = 7

// Sends the caller a real pulse-check invite, to themselves, so they can walk
// the exact link an employee gets and see the questionnaire as it will be
// rendered.
//
// Two things make this safe to expose:
//
//   1. The recipient address is read from the caller's own staff record
//      server-side. There is no address in the payload - a client-supplied one
//      would turn this into an open relay that mails arbitrary people a valid
//      pulse-check link from the company's domain.
//   2. The invite carries isTest, which rides through onto the response
//      document. analyzePulseResponse skips such a response entirely: no Claude
//      call, no sentimentScore, no aggregate. It cannot move a department
//      average or push a department over the k-anonymity floor, which would let
//      an admin unlock a suppressed number by testing five times.
exports.sendTestPulseInvite = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  // Company from the verified claim, never the payload - the same rule
  // sendPulseChecksNow.js follows, so a staff member cannot aim a test at
  // another company's questionnaire.
  const companyId = request.auth?.token?.companyId
  if (!companyId || (request.data?.companyId && request.data.companyId !== companyId)) {
    throw new HttpsError(
      'permission-denied',
      'Your account is not linked to this company, so it cannot send a test check-in'
    )
  }

  const staffSnap = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(uid)
    .get()
  if (!staffSnap.exists) {
    throw new HttpsError('permission-denied', 'You are not a staff member of this company')
  }
  const staff = staffSnap.data()
  if (!TEST_INVITE_ROLES.includes(staff.role)) {
    throw new HttpsError(
      'permission-denied',
      'Only a Company Admin, HR Coordinator or Pulse Check Reviewer may send a test check-in'
    )
  }

  // The one address this can ever reach. A staff record with no email cannot be
  // mailed, and inventing a fallback (the auth token's email, say) would
  // reintroduce exactly the indirection this is avoiding.
  const recipientEmail = typeof staff.email === 'string' ? staff.email.trim() : ''
  if (!recipientEmail) {
    throw new HttpsError(
      'failed-precondition',
      'Your staff record has no email address on file, so a test check-in cannot be sent'
    )
  }

  // The test uses the company's live published set, resolved the same way a
  // real invite is - the point of the test is to see what employees are being
  // sent, so a draft would be showing something nobody receives.
  const questionSetVersion = await activeQuestionSetVersion(firestore, companyId)

  const { inviteId, token } = await createPulseInvite(firestore, {
    companyId,
    // Namespaced so it can never collide with a roster employee id, and so a
    // test response is identifiable as one even if it is read raw.
    employeeId: `test:${uid}`,
    department: null,
    cadenceDays: TEST_INVITE_DAYS,
    questionSetVersion,
    isTest: true,
  })

  // Queued the same way a real invite is, so the test exercises the real
  // delivery path (deliverNotifications.js) rather than a parallel one that
  // could pass while the real one is broken.
  await firestore.collection(NOTIFICATIONS_COLLECTION).add({
    type: 'pulseCheckInvite',
    audience: 'employee',
    companyId,
    employeeId: `test:${uid}`,
    department: null,
    recipientEmail,
    inviteId,
    inviteToken: token,
    isTest: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
  })

  logger.info('sendTestPulseInvite: queued test invite', {
    companyId,
    actorUid: uid,
    questionSetVersion,
  })

  return { recipientEmail, questionSetVersion }
})

exports.TEST_INVITE_ROLES = TEST_INVITE_ROLES
exports.TEST_INVITE_DAYS = TEST_INVITE_DAYS
