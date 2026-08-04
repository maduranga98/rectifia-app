const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const {
  CASES_COLLECTION,
  randomPasscode,
  hashPasscode,
  generateUniqueCaseId,
} = require('./generateCaseAccess')

if (!admin.apps.length) {
  admin.initializeApp()
}

// The categories a case may be filed under. Mirrors the keys of
// src/data/categories.js / the questionnaires in src/data/questionnaires - a
// case whose category isn't one of these has no questionnaire and nothing
// downstream can score it, so it's rejected here rather than written as a
// dead document.
const KNOWN_CATEGORIES = new Set([
  'harassment',
  'toxicManagement',
  'retaliation',
  'burnout',
])

// Files a completed reporter questionnaire as a new case. This is the only
// path that creates a case document, and it deliberately requires no auth -
// reporters are anonymous and unauthenticated by design.
//
// The passcode is generated server-side (only its salted hash is stored) and
// returned once in this response; there is no recovery. Crucially, the
// category and responses collected by QuestionnaireForm are written onto the
// case at creation time, so scoreCase.js's onCreate trigger has the data it
// needs on the very first fire.
exports.submitCase = onCall(async (request) => {
  const { category, responses } = request.data || {}

  if (typeof category !== 'string' || !KNOWN_CATEGORIES.has(category)) {
    throw new HttpsError('invalid-argument', 'A valid case category is required')
  }

  if (!Array.isArray(responses) || responses.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'At least one questionnaire response is required'
    )
  }

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
      category,
      responses,
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { caseId, passcode }
})
