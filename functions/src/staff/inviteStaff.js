const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { sendMail, smtpPassword } = require('../utils/email')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Same deploy-time param the other outbound-email modules read (see
// notifications/sendContactEmailUpdate.js, notifications/deliverNotifications.js,
// sharing/createShare.js) - the bare app origin, used below to turn Firebase's
// generic password-reset action code into a link that actually lands on this
// app's own /invite/:token screen (AcceptInvitePage), and to give the invitee a
// plain link to Rectifia's sign-in page for later.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://rectifia-59a1e.web.app' })

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

// Normalises a raw departments input into the array-of-strings form the
// `departments` custom claim carries: trimmed, empties dropped, de-duplicated.
// The claim stores department *names* verbatim (the same string form
// pulseSummaries.department carries), never ids - see firestore.rules'
// pulseSummaries clause, which compares resource.data.department against this
// array. A non-array input yields an empty list rather than throwing, so a
// caller that omits departments simply gets a manager with none (which the
// pulse dashboard surfaces as "no departments assigned", never a silent grid).
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Builds the plain-text + HTML invitation email. inviteLink is this app's own
// /invite/:token URL (see buildAppInviteLink below) - not Firebase's generic
// hosted action page - so "Accept invitation" lands the invitee on
// AcceptInvitePage, where they set a password and continue straight into the
// dashboard. loginLink is the separate, permanent Rectifia sign-in page, given
// alongside it so the invitee (or anyone re-reading the email later) has a
// direct way back in after their password is already set, without having to
// hunt for a bookmark.
function buildInviteEmail({ companyName, roleLabel, inviteLink, loginLink }) {
  const company = companyName || 'your organization'
  const subject = `You've been invited to join ${company} on Rectifia`
  const text = [
    `You've been invited to join ${company} on Rectifia as a ${roleLabel}.`,
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
          <h1 style="margin: 0 0 16px; font-size: 20px; color: #0b2c49;">You've been invited</h1>
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
            You've been invited to join <strong>${escapeHtml(company)}</strong> on Rectifia as a
            <strong>${escapeHtml(roleLabel)}</strong>.
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

// Firebase's admin.auth().generatePasswordResetLink() points at its own
// generic hosted action page (…firebaseapp.com/__/auth/action), which never
// matches this app's /invite/:token route (AcceptInvitePage) - so an invitee
// who clicked it previously landed on Firebase's default UI, not Rectifia's
// branded accept-invite screen, and had no way back into the app afterwards.
// The oobCode is the one thing the app's own AcceptInvitePage actually needs
// (verifyInviteCode / acceptInvite in src/services/authService.js both take
// it directly), so it's pulled out of Firebase's link and rebuilt as this
// app's own URL instead.
function buildAppInviteLink(firebaseResetLink) {
  const oobCode = new URL(firebaseResetLink).searchParams.get('oobCode')
  if (!oobCode) {
    throw new Error('Password reset link did not contain an oobCode')
  }
  return `${appBaseUrl.value()}/invite/${oobCode}`
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
  const { companyId, email, role, actorId, departments } = request.data || {}
  if (!companyId || !email || !role) {
    throw new HttpsError('invalid-argument', 'companyId, email, and role are required')
  }
  if (!VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of ${VALID_ROLES.join(', ')}`)
  }

  // Department scoping only means anything for a Manager: the pulseSummaries
  // rule gates that one role on resource.data.department being in this claim.
  // For every other role the claim would be inert, so it is only stamped for a
  // manager - keeping other roles' tokens exactly as they were.
  const managerDepartments = role === 'manager' ? normalizeDepartments(departments) : []

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

  // Custom claims are the only thing firestore.rules trusts for role/scope
  // checks - never a Firestore field. The `departments` claim is the manager's
  // pulse-visibility scope; it is set here, alongside role + companyId, and is
  // only present for a manager.
  await admin.auth().setCustomUserClaims(userRecord.uid, {
    role,
    companyId,
    ...(role === 'manager' ? { departments: managerDepartments } : {}),
  })

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
      // A display-only mirror of the claim for the Staff page (a claim can't be
      // read off another user's account from the client). This copy is never
      // read for authorization - firestore.rules reads request.auth.token
      // exclusively - so it can't become a scope-escalation path.
      ...(role === 'manager' ? { departments: managerDepartments } : {}),
    })

  const firebaseResetLink = await admin.auth().generatePasswordResetLink(email)
  const inviteLink = buildAppInviteLink(firebaseResetLink)
  const loginLink = `${appBaseUrl.value()}/login`

  const companyName = companySnapshot.data()?.name
  const { subject, text, html } = buildInviteEmail({
    companyName,
    roleLabel: ROLE_LABELS[role] || role,
    inviteLink,
    loginLink,
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
