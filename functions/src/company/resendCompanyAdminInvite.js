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
const SUPER_ADMINS_COLLECTION = 'superAdmins'

// Same param every other outbound-email module reads (createCompanyAdmin.js,
// staff/inviteStaff.js) - the bare app origin the /invite/:token link is
// built on.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://app.rectifia.com' })

// Same cooldown resendStaffInvite.js uses, for the same reason: this is an
// authenticated Super Admin action against one staff doc, so a timestamp
// comparison read off that doc is enough - no counter doc, no rateLimit.js.
const RESEND_COOLDOWN_MS = 60 * 1000

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Same template as createCompanyAdmin.js's buildAdminInviteEmail with the
// copy adjusted to read as a reminder - kept as a local copy rather than a
// shared import, matching how resendStaffInvite.js relates to inviteStaff.js,
// so this wording can drift without touching the account-creation path.
// As there, no password appears anywhere in it: the link is the only way in.
function buildResendAdminInviteEmail({ companyName, inviteLink, loginLink }) {
  const company = companyName || 'your organization'
  const subject = `Reminder: set your Rectifia admin password for ${company}`
  const text = [
    `A Company Admin account for ${company} is waiting for you on Rectifia.`,
    '',
    'Set your password to activate it and open your dashboard:',
    inviteLink,
    '',
    `Already set your password? Sign in any time at ${loginLink}`,
    '',
    "If you weren't expecting this, you can safely ignore this email.",
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
          <h1 style="margin: 0 0 16px; font-size: 20px; color: #0b2c49;">Your admin account is waiting</h1>
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
            A Company Admin account for <strong>${escapeHtml(company)}</strong> is ready on Rectifia
            and still needs a password.
          </p>
          <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.5;">
            Set your password to activate it and open your dashboard:
          </p>
          <p style="margin: 24px 0;">
            <a href="${escapeHtml(inviteLink)}" style="background: #db9b3a; color: #0b2c49; text-decoration: none; font-weight: 600; padding: 13px 24px; border-radius: 8px; display: inline-block;">Set your password</a>
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
        If you weren't expecting this, you can safely ignore this email.
      </p>
    </div>
  `

  return { subject, text, html }
}

// Same rebuild as createCompanyAdmin.js's buildAppInviteLink - Firebase's
// generated reset link points at its own generic hosted action page, so the
// oobCode is pulled out and rebuilt onto this app's /invite/:token route
// (AcceptInvitePage).
function buildAppInviteLink(firebaseResetLink) {
  const oobCode = new URL(firebaseResetLink).searchParams.get('oobCode')
  if (!oobCode) {
    throw new Error('Password reset link did not contain an oobCode')
  }
  return `${appBaseUrl.value()}/invite/${oobCode}`
}

// Super Admin is allowlist membership at superAdmins/{uid}, not a custom
// claim (see src/constants/roles.js) - so this checks the doc, the same way
// createCompanyAdmin.js, firestore.rules and authService.checkSuperAdmin do.
async function requireSuperAdmin(actorUid) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Super Admin to resend a company admin invite')
  }
  const snapshot = await admin.firestore().collection(SUPER_ADMINS_COLLECTION).doc(actorUid).get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can resend a company admin invite')
  }
}

// Picks which Company Admin record the fresh link should be minted for, out
// of every companyAdmin staff doc a company has. Exported (and unit-tested)
// separately from the callable because the choice is the only part with real
// branching: a company can carry several Company Admins, and only the ones
// that never set a password are resendable at all - an admin who already
// accepted has a working password and uses "Forgot password" instead, so
// re-inviting them would be a wrong (and confusing) thing to do.
//
// Returns { admin } on success, or { error: { code, message } } shaped for
// HttpsError, so every refusal reads the same way whether it comes from here
// or the callable.
function selectPendingCompanyAdmin(admins, staffId = null) {
  if (staffId) {
    const match = admins.find((entry) => entry.id === staffId)
    if (!match) {
      return { error: { code: 'not-found', message: 'No Company Admin with that id in this company' } }
    }
    if (match.status !== 'invited') {
      return {
        error: {
          code: 'failed-precondition',
          message:
            'This admin has already set their password - they can reset it themselves from the sign-in page',
        },
      }
    }
    return { admin: match }
  }

  const pending = admins.filter((entry) => entry.status === 'invited')
  if (pending.length === 0) {
    return {
      error: {
        code: 'failed-precondition',
        message: admins.length
          ? 'Every Company Admin for this company has already set a password - they can reset it from the sign-in page'
          : 'This company has no Company Admin account yet',
      },
    }
  }
  if (pending.length > 1) {
    return {
      error: {
        code: 'failed-precondition',
        message: 'This company has more than one pending Company Admin - name the one to resend to',
      },
    }
  }
  return { admin: pending[0] }
}

// Mints and emails a fresh set-your-password link for a Company Admin who
// hasn't accepted yet. The link createCompanyAdmin.js hands over is a
// Firebase password-reset action code, which expires - so without this, an
// admin who clicked too late had no way in and the only workaround left was
// handing them a password out of band, which is exactly what this flow exists
// to avoid. Never touches the Auth account and never re-stamps custom claims
// (role/companyId were set at creation and must survive untouched - same
// invariant resendStaffInvite.js and acceptInvite.js hold).
exports.resendCompanyAdminInvite = onCall({ secrets: [smtpPassword] }, async (request) => {
  const { companyId, staffId } = request.data || {}
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }

  await requireSuperAdmin(request.auth?.uid)

  const firestore = admin.firestore()
  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'No such company')
  }

  const adminDocs = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .where('role', '==', 'companyAdmin')
    .get()

  const selection = selectPendingCompanyAdmin(
    adminDocs.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })),
    staffId ?? null
  )
  if (selection.error) {
    throw new HttpsError(selection.error.code, selection.error.message)
  }
  const target = selection.admin

  const lastSentAt = target.lastInviteResentAt ?? target.invitedAt ?? target.createdAt
  const lastSentMs = lastSentAt?.toMillis ? lastSentAt.toMillis() : null
  if (lastSentMs !== null && Date.now() - lastSentMs < RESEND_COOLDOWN_MS) {
    throw new HttpsError('resource-exhausted', 'An invite was just sent - please wait a minute before resending')
  }

  const firebaseResetLink = await admin.auth().generatePasswordResetLink(target.email)
  const inviteLink = buildAppInviteLink(firebaseResetLink)
  const loginLink = `${appBaseUrl.value()}/login`

  // Same failure discipline as createCompanyAdmin.js and resendStaffInvite.js:
  // a delivery failure must not fail the call, because the fresh link is
  // returned to the Super Admin either way and is the thing that matters.
  let emailDelivered = true
  try {
    const { subject, text, html } = buildResendAdminInviteEmail({
      companyName: companySnapshot.data()?.name,
      inviteLink,
      loginLink,
    })
    await sendMail({ to: target.email, subject, text, html })
  } catch (err) {
    emailDelivered = false
    logger.error('resendCompanyAdminInvite: invite email failed to send', {
      companyId,
      email: target.email,
      error: err.message,
    })
  }

  await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(target.id)
    .update({
      lastInviteResentAt: admin.firestore.FieldValue.serverTimestamp(),
      resendCount: admin.firestore.FieldValue.increment(1),
    })

  return { success: true, staffId: target.id, email: target.email, inviteLink, emailDelivered }
})

exports.selectPendingCompanyAdmin = selectPendingCompanyAdmin
