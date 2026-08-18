const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { randomBytes } = require('crypto')
const { sendMail, smtpPassword } = require('../utils/email')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const SUPER_ADMINS_COLLECTION = 'superAdmins'

// Same param the other outbound-email modules read (see
// staff/inviteStaff.js, notifications/sendContactEmailUpdate.js) - the bare
// app origin, used below to build the links this new Company Admin receives.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://rectifia-59a1e.web.app' })

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Builds the plain-text + HTML account-handover email. No password ever
// appears in it - clicking "Set your password" lands the new admin on
// AcceptInvitePage (via the app's own /invite/:token route, see
// buildAppInviteLink below), where they choose their own password and are
// dropped straight into their dashboard. Matches the visual language of
// staff/inviteStaff.js's invitation email, which uses the same link-based
// pattern.
function buildAdminInviteEmail({ companyName, inviteLink, loginLink }) {
  const company = companyName || 'your organization'
  const subject = `Your Rectifia admin account for ${company}`
  const text = [
    `A Company Admin account for ${company} has been created on Rectifia.`,
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
          <h1 style="margin: 0 0 16px; font-size: 20px; color: #0b2c49;">Your admin account is ready</h1>
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
            A Company Admin account for <strong>${escapeHtml(company)}</strong> has been created on
            Rectifia.
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

// Mirrors slugifyCompanyName in src/services/companyService.js. The company doc
// is normally created client-side with its slug already set; this is a safety
// net for docs that predate the slug field (or a client that somehow wrote one
// without a slug), so no company can reach the admin-creation step without a
// usable reporting slug.
function slugifyCompanyName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function allocateUniqueSlug(firestore, name) {
  const base = slugifyCompanyName(name) || 'company'
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const existing = await firestore
      .collection(COMPANIES_COLLECTION)
      .where('slug', '==', candidate)
      .limit(1)
      .get()
    if (existing.empty) return candidate
  }
  return `${base}-${randomBytes(3).toString('hex')}`
}

// Super Admin is allowlist membership at superAdmins/{uid}, not a custom
// claim (see src/constants/roles.js) - so this checks the doc, the same way
// firestore.rules and authService.checkSuperAdmin do.
async function requireSuperAdmin(actorUid) {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Sign in as a Super Admin to create a company admin')
  }
  const snapshot = await admin
    .firestore()
    .collection(SUPER_ADMINS_COLLECTION)
    .doc(actorUid)
    .get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can create a company admin')
  }
}

// Firebase's admin.auth().generatePasswordResetLink() points at its own
// generic hosted action page (…firebaseapp.com/__/auth/action), which never
// matches this app's /invite/:token route (AcceptInvitePage) - so the
// oobCode is pulled out of Firebase's link and rebuilt as this app's own URL
// instead. Mirrors buildAppInviteLink in staff/inviteStaff.js.
function buildAppInviteLink(firebaseResetLink) {
  const oobCode = new URL(firebaseResetLink).searchParams.get('oobCode')
  if (!oobCode) {
    throw new Error('Password reset link did not contain an oobCode')
  }
  return `${appBaseUrl.value()}/invite/${oobCode}`
}

// Creates the Company Admin account for a freshly registered company and
// emails the new admin a one-click link to set their own password
// (AcceptInvitePage, the same screen staff invites use) - no password is
// ever generated, shown, or handed over in plain text. The invite link is
// also returned to the caller so the Super Admin's confirmation screen can
// show it as a backup in case the email fails to deliver.
exports.createCompanyAdmin = onCall({ secrets: [smtpPassword] }, async (request) => {
  const { companyId, email } = request.data || {}
  if (!companyId || !email) {
    throw new HttpsError('invalid-argument', 'companyId and email are required')
  }

  await requireSuperAdmin(request.auth?.uid)

  const companySnapshot = await admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'No such company')
  }

  // Backfill a reporting slug for any company that reached this step without
  // one, so its /submit/:companySlug link resolves.
  if (!companySnapshot.data().slug) {
    const slug = await allocateUniqueSlug(admin.firestore(), companySnapshot.data().name)
    await companySnapshot.ref.update({ slug })
  }

  let userRecord
  try {
    // The account needs some password to exist, but nobody ever uses it -
    // the admin sets their own via the invite link below, the same as
    // inviteStaff.js's temporaryPassword.
    const temporaryPassword = admin.firestore().collection('_').doc().id + 'Aa1!'
    userRecord = await admin.auth().createUser({ email, password: temporaryPassword })
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with this email already exists')
    }
    if (err.code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'That email address is not valid')
    }
    logger.error('createCompanyAdmin: createUser failed', { companyId, error: err.message })
    throw new HttpsError('internal', 'Could not create the company admin account')
  }

  // Custom claims are the only thing firestore.rules trusts for role checks
  // - never a Firestore field.
  await admin.auth().setCustomUserClaims(userRecord.uid, {
    role: 'companyAdmin',
    companyId,
  })

  // 'invited' rather than 'active': the admin hasn't set their password yet.
  // AcceptInvitePage calls acceptInvite (functions/src/staff/acceptInvite.js)
  // once they do, which flips this to 'active' the same way it does for
  // invited staff.
  await admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(userRecord.uid)
    .set({
      email,
      role: 'companyAdmin',
      status: 'invited',
      createdBy: request.auth?.uid ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

  const firebaseResetLink = await admin.auth().generatePasswordResetLink(email)
  const inviteLink = buildAppInviteLink(firebaseResetLink)
  const loginLink = `${appBaseUrl.value()}/login`

  // A delivery failure shouldn't fail the whole call - the account and
  // invite link already exist and are returned to the Super Admin below -
  // so it's recorded and surfaced to the caller rather than thrown, the same
  // pattern inviteStaff.js uses.
  let emailDelivered = true
  try {
    const { subject, text, html } = buildAdminInviteEmail({
      companyName: companySnapshot.data()?.name,
      inviteLink,
      loginLink,
    })
    await sendMail({ to: email, subject, text, html })
  } catch (err) {
    emailDelivered = false
    logger.error('createCompanyAdmin: invite email failed to send', { companyId, email, error: err.message })
  }

  return { success: true, staffId: userRecord.uid, email, inviteLink, emailDelivered }
})
