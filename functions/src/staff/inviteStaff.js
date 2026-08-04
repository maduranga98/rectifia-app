const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { sendMail, smtpPassword } = require('../utils/email')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Must stay in lockstep with ROLES in src/constants/roles.js and the role
// checks in firestore.rules - a role added there needs adding here too.
const VALID_ROLES = ['companyAdmin', 'hrCoordinator', 'caseHandler', 'manager', 'pulseCheckReviewer']

// Human-readable role names for the invitation email. Mirrors ROLE_LABELS in
// src/constants/roles.js.
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

// Builds the plain-text + HTML invitation email. The inviteLink is the
// Firebase password-reset link the invitee uses to set their own password.
function buildInviteEmail({ companyName, roleLabel, inviteLink }) {
  const company = companyName || 'your organization'
  const subject = `You've been invited to join ${company} on Rectifia`
  const text = [
    `You've been invited to join ${company} on Rectifia as a ${roleLabel}.`,
    '',
    'To accept the invitation, set your password using the link below:',
    inviteLink,
    '',
    "If you weren't expecting this invitation, you can safely ignore this email.",
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px;">You've been invited to Rectifia</h2>
      <p>You've been invited to join <strong>${escapeHtml(company)}</strong> as a <strong>${escapeHtml(roleLabel)}</strong>.</p>
      <p>To accept the invitation, set your password using the button below:</p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(inviteLink)}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 6px; display: inline-block;">Accept invitation</a>
      </p>
      <p style="font-size: 13px; color: #666;">Or copy and paste this link into your browser:<br /><a href="${escapeHtml(inviteLink)}">${escapeHtml(inviteLink)}</a></p>
      <p style="font-size: 13px; color: #666;">If you weren't expecting this invitation, you can safely ignore this email.</p>
    </div>
  `

  return { subject, text, html }
}

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
exports.inviteStaff = onCall({ secrets: [smtpPassword] }, async (request) => {
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

  const companyName = companySnapshot.data()?.name
  const { subject, text, html } = buildInviteEmail({
    companyName,
    roleLabel: ROLE_LABELS[role] || role,
    inviteLink,
  })

  // Attempt SMTP delivery. A delivery failure shouldn't roll back the invite
  // (the account + staff doc are already created and the link is recoverable),
  // so we record the outcome on the notification doc and surface it to the
  // caller instead of throwing.
  let emailDelivered = true
  let deliveryError = null
  try {
    await sendMail({ to: email, subject, text, html })
  } catch (err) {
    emailDelivered = false
    deliveryError = err.message
    logger.error('inviteStaff: invitation email failed to send', { email, error: err.message })
  }

  await admin.firestore().collection(NOTIFICATIONS_COLLECTION).add({
    type: 'staffInvite',
    companyId,
    staffId: userRecord.uid,
    recipientEmail: email,
    role,
    inviteLink,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: emailDelivered ? 'sent' : 'failed',
    ...(deliveryError ? { deliveryError } : {}),
    sentAt: emailDelivered ? admin.firestore.FieldValue.serverTimestamp() : null,
  })

  return { success: true, staffId: userRecord.uid, emailDelivered }
})
