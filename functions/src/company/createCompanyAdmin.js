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
// app origin, used below to build the login link this new Company Admin
// receives alongside their credentials.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://rectifia-59a1e.web.app' })

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Builds the plain-text + HTML account-handover email: the credentials this
// call generated, plus the app's login page, so the new Company Admin doesn't
// depend on the Super Admin who created the company relaying anything by hand.
// Matches the visual language of staff/inviteStaff.js's invitation email.
function buildAdminCredentialsEmail({ companyName, email, password, loginLink }) {
  const company = companyName || 'your organization'
  const subject = `Your Rectifia admin account for ${company}`
  const text = [
    `A Company Admin account for ${company} has been created on Rectifia.`,
    '',
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    `Sign in at: ${loginLink}`,
    '',
    'For your security, sign in and change this password as soon as possible.',
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
          <table style="width: 100%; border-collapse: collapse; margin: 0 0 24px; font-size: 14px;">
            <tr>
              <td style="padding: 10px 12px; background: #f2f6fa; border-radius: 8px 0 0 8px; color: #14456f; font-weight: 600;">Email</td>
              <td style="padding: 10px 12px; background: #f2f6fa; border-radius: 0 8px 8px 0; font-family: monospace;">${escapeHtml(email)}</td>
            </tr>
            <tr><td colspan="2" style="height: 4px;"></td></tr>
            <tr>
              <td style="padding: 10px 12px; background: #f2f6fa; border-radius: 8px 0 0 8px; color: #14456f; font-weight: 600;">Temporary password</td>
              <td style="padding: 10px 12px; background: #f2f6fa; border-radius: 0 8px 8px 0; font-family: monospace;">${escapeHtml(password)}</td>
            </tr>
          </table>
          <p style="margin: 24px 0;">
            <a href="${escapeHtml(loginLink)}" style="background: #db9b3a; color: #0b2c49; text-decoration: none; font-weight: 600; padding: 13px 24px; border-radius: 8px; display: inline-block;">Sign in to Rectifia</a>
          </p>
          <p style="font-size: 13px; color: #666; margin: 0 0 8px;">
            Or copy and paste this link into your browser:<br />
            <a href="${escapeHtml(loginLink)}" style="color: #14456f;">${escapeHtml(loginLink)}</a>
          </p>
          <div style="border-top: 1px solid #e7edf3; padding-top: 16px; margin-top: 16px;">
            <p style="font-size: 13px; color: #666; margin: 0;">
              For your security, sign in and change this password as soon as possible.
            </p>
          </div>
        </div>
      </div>
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

// Character sets chosen to avoid glyphs that get misread when the Super
// Admin copies the password out of the UI and reads it to someone over the
// phone (no O/0, l/1/I).
const UPPERCASE = 'ABCDEFGHJKMNPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghijkmnpqrstuvwxyz'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%*?'

function pick(charset, bytes, offset) {
  return charset[bytes[offset] % charset.length]
}

// Generates a password that is shown once, in plain text, to the Super
// Admin who created the company - there is no invite email in this flow, so
// this string is the only way the new Company Admin gets in.
function generatePassword(length = 14) {
  const bytes = randomBytes(length)
  const all = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS
  const chars = [
    pick(UPPERCASE, bytes, 0),
    pick(LOWERCASE, bytes, 1),
    pick(DIGITS, bytes, 2),
    pick(SYMBOLS, bytes, 3),
  ]
  for (let i = 4; i < length; i += 1) {
    chars.push(pick(all, bytes, i))
  }
  return chars.join('')
}

// Creates the Company Admin account for a freshly registered company and
// returns its credentials to the caller so the Super Admin can hand them
// over directly. Deliberately does NOT queue a staffInvite notification the
// way inviteStaff.js does: invitation delivery is out of scope for now, the
// credentials shown in the UI are the handover mechanism.
//
// The password is returned exactly once, in this response - it is never
// written to Firestore and cannot be read back afterwards. If it is lost,
// the Company Admin must use the password-reset flow.
//
// It is also emailed directly to the new admin (buildAdminCredentialsEmail
// below), alongside the app's login link, rather than relying solely on the
// Super Admin who created the company to relay it by hand - the credentials
// screen in the UI still shows it once for the Super Admin's own records, but
// the new admin no longer depends on that handover happening correctly.
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

  const password = generatePassword()

  let userRecord
  try {
    userRecord = await admin.auth().createUser({ email, password })
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

  // 'active' rather than 'invited': there is no invite for this account to
  // accept, it can sign in with the credentials shown to the Super Admin.
  await admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(userRecord.uid)
    .set({
      email,
      role: 'companyAdmin',
      status: 'active',
      createdBy: request.auth?.uid ?? null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

  // A delivery failure shouldn't fail the whole call - the account exists and
  // the credentials are already returned to the Super Admin below - so it's
  // recorded and surfaced to the caller rather than thrown, the same pattern
  // inviteStaff.js uses.
  let emailDelivered = true
  try {
    const { subject, text, html } = buildAdminCredentialsEmail({
      companyName: companySnapshot.data()?.name,
      email,
      password,
      loginLink: `${appBaseUrl.value()}/login`,
    })
    await sendMail({ to: email, subject, text, html })
  } catch (err) {
    emailDelivered = false
    logger.error('createCompanyAdmin: credentials email failed to send', { companyId, email, error: err.message })
  }

  return { success: true, staffId: userRecord.uid, email, password, emailDelivered }
})
