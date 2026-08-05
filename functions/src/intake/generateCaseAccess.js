const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const PASSCODE_LENGTH = 12
// Excludes 0/O and 1/I/l so a hand-copied passcode isn't ambiguous.
const PASSCODE_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const SCRYPT_KEY_LENGTH = 64
const MAX_CASE_ID_ATTEMPTS = 10

function randomCaseId() {
  const year = new Date().getFullYear()
  const number = crypto.randomInt(1000, 10000)
  return `RC-${year}-${number}`
}

function randomPasscode() {
  let passcode = ''
  for (let i = 0; i < PASSCODE_LENGTH; i += 1) {
    passcode += PASSCODE_ALPHABET[crypto.randomInt(PASSCODE_ALPHABET.length)]
  }
  return passcode
}

function hashPasscode(passcode, salt) {
  return crypto.scryptSync(passcode, salt, SCRYPT_KEY_LENGTH).toString('hex')
}

async function generateUniqueCaseId(firestore) {
  for (let attempt = 0; attempt < MAX_CASE_ID_ATTEMPTS; attempt += 1) {
    const caseId = randomCaseId()
    const existing = await firestore
      .collection(CASES_COLLECTION)
      .doc(caseId)
      .get()
    if (!existing.exists) {
      return caseId
    }
  }
  throw new HttpsError(
    'resource-exhausted',
    'Could not allocate a unique case ID, please try again'
  )
}

// Case access credentials are generated server-side so the passcode can never
// be spoofed or predicted by a client; only its salted hash is persisted. The
// plaintext passcode is returned to the caller once and nowhere else - there
// is no recovery flow, since a recovery flow would need an identity to recover
// to. The actual case document is now written by submitCase.js, which reuses
// these helpers so the reporter's category/answers land on the case at
// creation time; these exports let it do that without duplicating the ID
// allocation or hashing logic.
exports.CASES_COLLECTION = CASES_COLLECTION
exports.randomPasscode = randomPasscode
exports.hashPasscode = hashPasscode
exports.generateUniqueCaseId = generateUniqueCaseId

// Validates a reporter-supplied Case ID + passcode against the stored salted
// hash. This is the only path that may read a case document, per the
// Firestore rules - clients cannot read the `cases` collection directly.
exports.validateCaseAccess = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { caseId, passcode } = request.data || {}

  // This is the brute-force surface. The Case ID keyspace is RC-YYYY-NNNN -
  // 9000 ids per year - so the id is not a secret and the passcode is doing
  // all the work; a low hourly ceiling per caller is what stops an attacker
  // grinding through either. It runs before the id is even parsed, so a
  // throttled caller learns nothing about which ids exist.
  await enforceRateLimit(admin.firestore(), 'validateCaseAccess', request)

  if (
    typeof caseId !== 'string' ||
    typeof passcode !== 'string' ||
    !caseId ||
    !passcode
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Case ID and passcode are required'
    )
  }

  const firestore = admin.firestore()
  const snapshot = await firestore.collection(CASES_COLLECTION).doc(caseId).get()

  if (!snapshot.exists) {
    return { valid: false }
  }

  const caseData = snapshot.data()
  const { passcodeHash, passcodeSalt, status, createdAt } = caseData
  const candidateHash = hashPasscode(passcode, passcodeSalt)

  const expected = Buffer.from(passcodeHash, 'hex')
  const candidate = Buffer.from(candidateHash, 'hex')
  const matches =
    expected.length === candidate.length &&
    crypto.timingSafeEqual(expected, candidate)

  if (!matches) {
    return { valid: false }
  }

  // tier and hasContactEmail are here so the reporter's own case view can show
  // them the state of their own choices (module 20): whether they are still
  // anonymous, and whether they have a contact address on file. Both are about
  // the reader themselves, and this response only ever reaches someone who has
  // just proved they hold the passcode.
  //
  // hasContactEmail is a boolean and never the address - not the plaintext,
  // not the envelope. The panel needs to know whether to offer "add" or
  // "remove", which presence alone answers; shipping the ciphertext to a
  // browser to answer the same question would put it somewhere it could be
  // kept. Same for the identity: the tier says the reporter identified
  // themselves, and reading what they said still goes through revealIdentity.
  return {
    valid: true,
    case: {
      caseId,
      status,
      createdAt,
      // Same reading normalizeTier() applies in submitCase.js - a case written
      // before the field existed has no tier and is anonymous - repeated
      // literally rather than imported, because submitCase.js already requires
      // this module and importing back would close the cycle.
      tier: caseData.tier === 'confidential' ? 'confidential' : 'anonymous',
      hasContactEmail: Boolean(caseData.contactEmail),
    },
  }
})
