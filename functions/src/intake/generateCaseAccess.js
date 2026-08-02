const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')

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

// Creates a new case and its access credentials. The passcode is generated
// here, server-side, so it can never be spoofed or predicted by a client;
// only its salted hash is persisted. The plaintext passcode is returned in
// this response and nowhere else - there is no recovery flow, since a
// recovery flow would need an identity to recover to.
exports.generateCaseAccess = onCall(async () => {
  const firestore = admin.firestore()

  const caseId = await generateUniqueCaseId(firestore)
  const passcode = randomPasscode()
  const passcodeSalt = crypto.randomBytes(16).toString('hex')
  const passcodeHash = hashPasscode(passcode, passcodeSalt)

  await firestore
    .collection(CASES_COLLECTION)
    .doc(caseId)
    .set({
      caseId,
      passcodeHash,
      passcodeSalt,
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { caseId, passcode }
})

// Validates a reporter-supplied Case ID + passcode against the stored salted
// hash. This is the only path that may read a case document, per the
// Firestore rules - clients cannot read the `cases` collection directly.
exports.validateCaseAccess = onCall(async (request) => {
  const { caseId, passcode } = request.data || {}

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

  const { passcodeHash, passcodeSalt, status, createdAt } = snapshot.data()
  const candidateHash = hashPasscode(passcode, passcodeSalt)

  const expected = Buffer.from(passcodeHash, 'hex')
  const candidate = Buffer.from(candidateHash, 'hex')
  const matches =
    expected.length === candidate.length &&
    crypto.timingSafeEqual(expected, candidate)

  if (!matches) {
    return { valid: false }
  }

  return { valid: true, case: { caseId, status, createdAt } }
})
