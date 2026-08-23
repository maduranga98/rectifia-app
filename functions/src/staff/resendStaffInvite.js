const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { sendMail, smtpPassword } = require('../utils/email')
const { requireCompanyNotBlocked } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Same deploy-time param inviteStaff.js reads - see that file's comment for
// why the invite link has to be rebuilt onto this app's own /invite/:token
// route rather than left as Firebase's generic hosted action link.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://app.rectifia.com' })

// A resend may not be requested more often than this - an authenticated
// Company Admin action against their own roster, not the public/reporter
// surface rateLimit.js exists for, so a plain timestamp comparison read off
// the staff doc is enough; no counter document, no rateLimit.js.
const RESEND_COOLDOWN_MS = 60 * 1000

// Mirrors ROLE_LABELS in inviteStaff.js - kept as its own copy rather than a
// shared import, matching this file's self-contained style.
const ROLE_LABELS = {
  companyAdmin: 'Company Admin',
  hrCoordinator: 'HR Coordinator',
  caseHandler: 'Case Handler',
  manager: 'Manager',
  pulseCheckReviewer: 'Pulse Check Reviewer',
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Same template as inviteStaff.js's buildInviteEmail, with copy adjusted to
// read as a resend rather than a first invitation - kept as its own local
// copy (see the module comment above) rather than importing inviteStaff.js's
// version, so this file's email wording can drift from the original invite's
// without touching that module.
function buildResendInviteEmail({ companyName, roleLabel, inviteLink, loginLink }) {
  const company = companyName || 'your organization'
  const subject = `Reminder: your invitation to join ${company} on Rectifia`
  const text = [
    `This is a reminder that you've been invited to join ${company} on Rectifia as a ${roleLabel}.`,
    '',
    'To accept the invitation, set your password using the link below:',
    inviteLink,
    '',
    `Already set your password? Sign in any time at ${loginLink}`,
    '',
    "If you weren't expecting this invitation, you can safely ignore this email.",
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #f2f6fa; padding: 32px 16px;">
      <div style="background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(11, 44, 73, 0.12);">
        <div style="background: #0b2c49; padding: 28px 32px;">
          <p style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.02em; color: #ffffff;">
            Rectifia<span style="color: #db9b3a;">.</span>
          </p>
          <p style="margin: 4px 0 0; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #9db4c9;">
            Confidential reporting platform
          </p>
        </div>
        <div style="padding: 32px; color: #1a1a1a;">
          <h1 style="margin: 0 0 16px; font-size: 20px; color: #0b2c49;">Your invitation is waiting</h1>
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
            This is a reminder that you've been invited to join <strong>${escapeHtml(company)}</strong> on
            Rectifia as a <strong>${escapeHtml(roleLabel)}</strong>.
          </p>
          <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.5;">
            Set your password to accept the invitation and open your dashboard:
          </p>
          <p style="margin: 24px 0;">
            <a href="${escapeHtml(inviteLink)}" style="background: #db9b3a; color: #0b2c49; text-decoration: none; font-weight: 600; padding: 13px 24px; border-radius: 8px; display: inline-block;">Accept invitation</a>
          </p>
          <p style="font-size: 13px; color: #666; margin: 0 0 24px;">
            Or copy and paste this link into your browser:<br />
            <a href="${escapeHtml(inviteLink)}" style="color: #14456f;">${escapeHtml(inviteLink)}</a>
          </p>
          <div style="border-top: 1px solid #e7edf3; padding-top: 16px; margin-top: 8px;">
            <p style="font-size: 13px; color: #666; margin: 0;">
              Already set your password? Sign in any time at
              <a href="${escapeHtml(loginLink)}" style="color: #14456f;">${escapeHtml(loginLink)}</a>.
            </p>
          </div>
        </div>
      </div>
      <p style="font-size: 12px; color: #9db4c9; text-align: center; margin: 20px 0 0;">
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>
  `

  return { subject, text, html }
}

// Same rebuild as inviteStaff.js's buildAppInviteLink - Firebase's generated
// reset link points at its own generic hosted action page, so the oobCode is
// pulled out of it and rebuilt onto this app's own /invite/:token route
// (AcceptInvitePage).
function buildAppInviteLink(firebaseResetLink) {
  const oobCode = new URL(firebaseResetLink).searchParams.get('oobCode')
  if (!oobCode) {
    throw new Error('Password reset link did not contain an oobCode')
  }
  return `${appBaseUrl.value()}/invite/${oobCode}`
}

// Same local convention as inviteStaff.js / removeStaffMember.js /
// updateStaffDepartments.js: duplicated rather than factored into a shared
// util, one per callable.
async function requireCompanyAdmin(actorUid, companyId) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Company Admin to resend a staff invite')
  }
  const actor = await admin.auth().getUser(actorUid)
  const claims = actor.customClaims || {}
  if (claims.role !== 'companyAdmin' || claims.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Only a Company Admin for this company can resend a staff invite')
  }
}

// Resends the set-your-password invitation for a staff member still stuck in
// status: 'invited'. Never re-creates the Auth account (it already exists
// from the original inviteStaff call) and never re-stamps custom claims
// (role/companyId/departments were set correctly at the original invite and
// must survive untouched - see acceptInvite.js's own comment on the same
// invariant). This is purely: mint a fresh password-reset action link, email
// it again, and record that a resend happened.
exports.resendStaffInvite = onCall({ secrets: [smtpPassword] }, async (request) => {
  const actorUid = request.auth?.uid
  const { companyId, staffId } = request.data || {}
  if (!companyId || !staffId) {
    throw new HttpsError('invalid-argument', 'companyId and staffId are required')
  }

  await requireCompanyAdmin(actorUid, companyId)
  await requireCompanyNotBlocked(admin.firestore(), companyId, {
    uid: actorUid,
    role: 'companyAdmin',
    action: 'resend_staff_invite',
  })

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

  if (staffData.status !== 'invited') {
    throw new HttpsError(
      'failed-precondition',
      staffData.status === 'suspended'
        ? 'This person is suspended, not pending an invite'
        : 'This person has already accepted their invite'
    )
  }

  const lastSentAt = staffData.lastInviteResentAt ?? staffData.invitedAt
  const lastSentMs = lastSentAt?.toMillis ? lastSentAt.toMillis() : null
  if (lastSentMs !== null && Date.now() - lastSentMs < RESEND_COOLDOWN_MS) {
    throw new HttpsError('resource-exhausted', 'An invite was just sent - please wait a minute before resending')
  }

  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()

  const firebaseResetLink = await admin.auth().generatePasswordResetLink(staffData.email)
  const inviteLink = buildAppInviteLink(firebaseResetLink)
  const loginLink = `${appBaseUrl.value()}/login`

  const companyName = companySnapshot.data()?.name
  const roleLabel = staffData.role ? ROLE_LABELS[staffData.role] || staffData.role : 'team member with a custom role'
  const { subject, text, html } = buildResendInviteEmail({ companyName, roleLabel, inviteLink, loginLink })

  // Same failure discipline as inviteStaff.js: a delivery failure must not
  // roll back the resend (the fresh link is recoverable, and the account is
  // untouched either way), so the outcome is recorded on the notification
  // doc and surfaced to the caller instead of thrown.
  let emailDelivered = true
  let deliveryError = null
  try {
    await sendMail({ to: staffData.email, subject, text, html })
  } catch (err) {
    emailDelivered = false
    deliveryError = err.message
    logger.error('resendStaffInvite: invitation email failed to send', { email: staffData.email, error: err.message })
  }

  await staffRef.update({
    lastInviteResentAt: admin.firestore.FieldValue.serverTimestamp(),
    resendCount: admin.firestore.FieldValue.increment(1),
  })

  const notificationRef = await firestore.collection(NOTIFICATIONS_COLLECTION).add({
    type: 'staffInviteResend',
    companyId,
    staffId,
    recipientEmail: staffData.email,
    inviteLink,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: emailDelivered ? 'sent' : 'failed',
    ...(deliveryError ? { deliveryError } : {}),
    sentAt: emailDelivered ? admin.firestore.FieldValue.serverTimestamp() : null,
  })

  return { success: true, staffId, emailDelivered, notificationId: notificationRef.id }
})
