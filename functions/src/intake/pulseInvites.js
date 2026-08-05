const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { hashPasscode } = require('./generateCaseAccess')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')

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

// This counter is NOT what makes the token unguessable - 32 random bytes
// already puts guessing a specific invite's token far out of reach, with or
// without a ceiling. What it bounds is write amplification: someone who knows
// (or scrapes) a valid invite id can otherwise hammer validatePulseInvite and
// force an unbounded number of Firestore transactions against that one
// document. So the budget only has to be small enough to cap that cost, not
// small enough to matter cryptographically - which is why it can be generous
// enough that a real employee never reaches it. Only failed token
// verifications count against it (a correct token resets it to 0), so the
// budget is spent exclusively by callers who do not hold the token.
const MAX_VALIDATION_ATTEMPTS = 20

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

const COMPANIES_COLLECTION = 'companies'

// Validates an invite id + token before the pulse-check form is rendered. This
// only tells the caller whether the invite is live and, if so, the company /
// department the form belongs to - it never reveals employeeId, and it never
// marks the invite used. Actually spending the invite happens only inside
// submitPulseResponse's transaction, so validating and then abandoning the form
// leaves the invite usable.
//
// On failure it returns a coarse `reason` so the page can distinguish the
// cases an employee needs told apart - 'used' (their response is already
// recorded), 'expired', or 'invalid' (bad/unknown token). The reason is
// deliberately coarse: it never leaks whether an invite id exists beyond what
// the employee already holds, and 'used'/'expired' are only ever returned to a
// caller who presented the correct token for that specific invite.
exports.validatePulseInvite = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { inviteId, token } = request.data || {}

  // Complements the per-invite MAX_VALIDATION_ATTEMPTS budget below, which
  // bounds guesses against one known invite id. This bounds how many *invite
  // ids* a single caller can try in an hour, which that per-document counter
  // cannot see.
  await enforceRateLimit(admin.firestore(), 'validatePulseInvite', request)
  if (typeof inviteId !== 'string' || typeof token !== 'string' || !inviteId || !token) {
    throw new HttpsError('invalid-argument', 'inviteId and token are required')
  }

  const firestore = admin.firestore()
  const ref = firestore.collection(PULSE_INVITES_COLLECTION).doc(inviteId)

  const result = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists) {
      return { valid: false, reason: 'invalid' }
    }
    const data = snapshot.data()

    const attempts = data.validationAttempts || 0
    if (attempts >= MAX_VALIDATION_ATTEMPTS) {
      throw new HttpsError('resource-exhausted', 'Too many attempts for this invite')
    }
    // Whether the invite is used/expired/unknown is only disclosed to a caller
    // who actually holds the matching token; a wrong token always looks the
    // same ('invalid') regardless of the invite's real state.
    if (!verifyInviteToken(token, data.tokenHash, data.tokenSalt)) {
      // Only a FAILED verification spends the budget. Counting every call -
      // including successful ones - meant an employee who opened their own
      // valid link often enough permanently bricked it, locking themselves out
      // of a check-in they were entitled to with no recovery path.
      tx.update(ref, { validationAttempts: attempts + 1 })
      return { valid: false, reason: 'invalid' }
    }

    // Reaching this line requires holding the 256-bit token, so clearing the
    // counter cannot help a brute-forcer: they can't get here without already
    // having won. It does stop stray failed attempts (a truncated link, a
    // mangled copy/paste) accumulating over an invite's life until the real
    // employee is refused.
    if (attempts !== 0) {
      tx.update(ref, { validationAttempts: 0 })
    }

    // Expire lazily: an invite past its cadence window is dead even if the
    // scheduler hasn't yet overwritten it with the next send.
    if (data.expiresAt && data.expiresAt.toMillis() <= Date.now()) {
      if (data.status === 'pending') {
        tx.update(ref, { status: 'expired' })
      }
      return { valid: false, reason: 'expired' }
    }
    if (data.status === 'used') {
      return { valid: false, reason: 'used' }
    }
    // A 'superseded' invite is one a newer send has replaced (see
    // queuePulseInvitesForCompany in schedulePulseChecks.js): the employee is
    // holding an older link and a fresher one exists. Tell them their link has
    // expired - the same thing that happens when a link ages out - rather than
    // 'invalid', which reads as "your link is malformed" and would send them
    // looking for a fault that isn't theirs.
    if (data.status === 'superseded') {
      return { valid: false, reason: 'expired' }
    }
    if (data.status !== 'pending') {
      return { valid: false, reason: 'invalid' }
    }

    return {
      valid: true,
      invite: { companyId: data.companyId, department: data.department ?? null },
    }
  })

  // Resolve the company's display name outside the transaction (no write
  // depends on it) so the form can show the employee which organization the
  // check-in is for - the only way they can tell a genuine invite from a
  // phishing link. companyId itself is never surfaced to the page.
  if (result.valid) {
    const companySnap = await firestore.collection(COMPANIES_COLLECTION).doc(result.invite.companyId).get()
    result.invite.companyName = companySnap.exists ? companySnap.data().name ?? null : null
  }

  return result
})

exports.PULSE_INVITES_COLLECTION = PULSE_INVITES_COLLECTION
exports.createPulseInvite = createPulseInvite
exports.verifyInviteToken = verifyInviteToken
exports.MAX_VALIDATION_ATTEMPTS = MAX_VALIDATION_ATTEMPTS
