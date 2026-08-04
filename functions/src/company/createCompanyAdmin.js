const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { randomBytes } = require('crypto')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const SUPER_ADMINS_COLLECTION = 'superAdmins'

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
exports.createCompanyAdmin = onCall(async (request) => {
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

  return { success: true, staffId: userRecord.uid, email, password }
})
