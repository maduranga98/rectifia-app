const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const {
  CASES_COLLECTION,
  randomPasscode,
  hashPasscode,
  generateUniqueCaseId,
} = require('./generateCaseAccess')
const { resolveCompanyBySlug } = require('../company/resolveCompanySlug')

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
//
// The reporter's link carries a company slug, not a companyId. We resolve the
// slug to a companyId here, server-side, and never trust a companyId sent by
// the client - a spoofed one would let a reporter file into another company's
// queue. companyId is what routeCase.js and the company-scoped dashboards (HR
// Coordinator, Case Handler) key on to find their cases, so a case written
// without it is effectively invisible to the company; that's why an
// unresolvable slug is rejected here rather than written as an orphan case.
exports.submitCase = onCall(async (request) => {
  const { category, responses, companySlug } = request.data || {}

  if (typeof category !== 'string' || !KNOWN_CATEGORIES.has(category)) {
    throw new HttpsError('invalid-argument', 'A valid case category is required')
  }

  if (!Array.isArray(responses) || responses.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'At least one questionnaire response is required'
    )
  }

  if (typeof companySlug !== 'string' || !companySlug.trim()) {
    throw new HttpsError('invalid-argument', 'A company slug is required')
  }

  const company = await resolveCompanyBySlug(companySlug)
  if (!company) {
    throw new HttpsError('not-found', 'This reporting link is not valid')
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
      companyId: company.companyId,
      passcodeHash,
      passcodeSalt,
      category,
      responses,
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { caseId, passcode }
})
