const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { hashPasscode } = require('./generateCaseAccess')

if (!admin.apps.length) {
  admin.initializeApp()
}

const PULSE_INVITES_COLLECTION = 'pulseInvites'

// 32 raw bytes -> 64 hex characters, comfortably above the 32-character
// minimum. The token is the single credential a roster employee (who has no
// account) uses to reach and submit their pulse check, so it is generated
// server-side and only ever returned in plaintext to the scheduler that queues
// the notification - exactly like a case passcode, only its salted hash is
// stored.
const TOKEN_BYTES = 32
const SALT_BYTES = 16
const DAY_MS = 24 * 60 * 60 * 1000

// Same brute-force ceiling shape as the case-ID allocation in
// generateCaseAccess.js: 10 validation attempts per invite id, after which the
// token can no longer be guessed against that known id.
const MAX_VALIDATION_ATTEMPTS = 10

function randomToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex')
}

// Reuses generateCaseAccess.js's scrypt hashing (hashPasscode) rather than
// inventing a second scheme, and the same constant-time compare validateCaseAccess
// uses, so a stored pulse-invite hash is verified exactly the way a case
// passcode is.
function verifyInviteToken(token, tokenHash, tokenSalt) {
  if (typeof token !== 'string' || !tokenHash || !tokenSalt) return false
  const candidate = Buffer.from(hashPasscode(token, tokenSalt), 'hex')
  const expected = Buffer.from(tokenHash, 'hex')
  return (
    expected.length === candidate.length &&
    crypto.timingSafeEqual(expected, candidate)
  )
}

// Creates a single-use invite for one roster employee and returns its id plus
// the plaintext token - the token is returned here exactly once and never
// stored, so the caller (schedulePulseChecks.js) is the only place it exists in
// the clear. expiresAt is createdAt + the company's cadence period, so an
// invite dies precisely when the next cadence send is due: there is never more
// than one live invite per employee, and a lost invite is simply replaced by
// the next send - the same deliberate no-recovery stance as the Case ID +
// passcode model, so there is no resend or recovery path here on purpose.
async function createPulseInvite(firestore, { companyId, employeeId, department, cadenceDays }) {
  if (!companyId || !employeeId) {
    throw new Error('companyId and employeeId are required to create a pulse invite')
  }
  const token = randomToken()
  const tokenSalt = crypto.randomBytes(SALT_BYTES).toString('hex')
  const tokenHash = hashPasscode(token, tokenSalt)

  const nowMs = Date.now()
  const Timestamp = admin.firestore.Timestamp
  const ref = firestore.collection(PULSE_INVITES_COLLECTION).doc()
  await ref.set({
    companyId,
    employeeId,
    department: department ?? null,
    tokenHash,
    tokenSalt,
    createdAt: Timestamp.fromMillis(nowMs),
    expiresAt: Timestamp.fromMillis(nowMs + Number(cadenceDays) * DAY_MS),
    usedAt: null,
    status: 'pending',
    validationAttempts: 0,
  })

  return { inviteId: ref.id, token }
}

// Validates an invite id + token before the pulse-check form is rendered. This
// only tells the caller whether the invite is live and, if so, the company /
// department the form belongs to - it never reveals employeeId, and it never
// marks the invite used. Actually spending the invite happens only inside
// submitPulseResponse's transaction, so validating and then abandoning the form
// leaves the invite usable.
exports.validatePulseInvite = onCall(async (request) => {
  const { inviteId, token } = request.data || {}
  if (typeof inviteId !== 'string' || typeof token !== 'string' || !inviteId || !token) {
    throw new HttpsError('invalid-argument', 'inviteId and token are required')
  }

  const firestore = admin.firestore()
  const ref = firestore.collection(PULSE_INVITES_COLLECTION).doc(inviteId)

  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) {
      return { valid: false }
    }
    const data = snapshot.data()

    const attempts = data.validationAttempts || 0
    if (attempts >= MAX_VALIDATION_ATTEMPTS) {
      throw new HttpsError('resource-exhausted', 'Too many attempts for this invite')
    }
    // Count this attempt regardless of outcome, so a brute-force run against a
    // known invite id burns through the budget whether or not each guess is
    // right.
    tx.update(ref, { validationAttempts: attempts + 1 })

    // Expire lazily: an invite past its cadence window is dead even if the
    // scheduler hasn't yet overwritten it with the next send.
    if (data.expiresAt && data.expiresAt.toMillis() <= Date.now()) {
      if (data.status === 'pending') {
        tx.update(ref, { status: 'expired' })
      }
      return { valid: false }
    }
    if (data.status !== 'pending') {
      return { valid: false }
    }
    if (!verifyInviteToken(token, data.tokenHash, data.tokenSalt)) {
      return { valid: false }
    }

    return {
      valid: true,
      invite: { companyId: data.companyId, department: data.department ?? null },
    }
  })
})

exports.PULSE_INVITES_COLLECTION = PULSE_INVITES_COLLECTION
exports.createPulseInvite = createPulseInvite
exports.verifyInviteToken = verifyInviteToken
exports.MAX_VALIDATION_ATTEMPTS = MAX_VALIDATION_ATTEMPTS
