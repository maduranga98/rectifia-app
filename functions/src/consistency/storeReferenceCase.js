const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { deriveDepartmentTier } = require('./departmentTier')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const REFERENCE_CASES_COLLECTION = 'referenceCases'

// Fires when a case's status transitions to 'closed' - not on every update,
// so a case that gets re-scored (aiFollowUp.js) or reassigned before then
// isn't stored early, and a case is only ever stored once (before/after
// both being 'closed' on a later, unrelated update to the same case is not
// a fresh transition).
//
// Stores scores and coarse metadata only - never the case narrative, the
// reporter's account, questionnaire free text, or any name - by design,
// so this reference pool can never itself become a way to re-identify a
// past complainant, witness, or accused. checkConsistency.js reads only
// this collection, never the source case, to build its comparison.
exports.storeReferenceCase = onDocumentUpdated(`${CASES_COLLECTION}/{caseId}`, async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const caseId = event.params.caseId

  const justClosed = after.status === 'closed' && before.status !== 'closed'
  if (!justClosed) return

  if (typeof after.severityScore !== 'number' || typeof after.evidenceScore !== 'number') {
    logger.error('storeReferenceCase: closed case has no scores, skipping', { caseId })
    return
  }

  const firestore = admin.firestore()
  await firestore.collection(REFERENCE_CASES_COLLECTION).add({
    companyId: after.companyId ?? null,
    category: after.category ?? null,
    severityScore: after.severityScore,
    evidenceScore: after.evidenceScore,
    department: deriveDepartmentTier(after.category, after.responses),
    actionTaken: after.actionTaken ?? null,
    // Whether the reporter filed this themselves or a staff member typed it
    // up. Coarse provenance in the same spirit as the department *tier*
    // above - it says nothing about who reported or what they said, but it
    // matters to a comparison: a case taken down second-hand by phone has
    // been through a listener's summarising before it was ever scored, so
    // "this outcome is out of line with comparable cases" reads differently
    // depending which pool the comparables came from. Without it, staff-filed
    // and reporter-filed cases are indistinguishable in the reference pool
    // and any such difference is invisible.
    //
    // Deliberately not enteredByUid: the pool is cross-company and permanent,
    // and a staff uid in it would let the reference set be filtered down to
    // one intake taker's cases, which for a small company is close to naming
    // the people involved.
    source: after.source ?? 'reporter',
    closedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
})
