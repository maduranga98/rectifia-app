const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { ACTION_TAKEN_OPTIONS, normalizeAction } = require('../consistency/actionVocabulary')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const OPEN_STATUSES_ALLOWING_ACTION = ['open', 'assigned', 'needs_manual_assignment']

// Staff authentication doesn't exist in this codebase yet (see the same
// caveat in caseThread.js / routeCase.js) - investigatorId is trusted as the
// caller-supplied assigned handler, not verified against a Firebase Auth
// identity.
async function loadCaseForHandler(firestore, caseId, investigatorId) {
  if (!caseId || !investigatorId) {
    throw new HttpsError('invalid-argument', 'caseId and investigatorId are required')
  }

  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)
  const snapshot = await caseRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such case')
  }
  if (snapshot.data().assignedHandlerId !== investigatorId) {
    throw new HttpsError('permission-denied', 'This case is not assigned to you')
  }

  return { caseRef, snapshot }
}

// Records the Case Handler's proposed action. This write is exactly what
// checkConsistency.js's onDocumentUpdated trigger reacts to (module 10) -
// proposing an action here is what starts that check running; this
// function itself never reads or writes consistencyCheck.
exports.proposeAction = onCall(async (request) => {
  const { caseId, investigatorId, actionCategory, notes, effectiveDate } = request.data || {}
  if (!ACTION_TAKEN_OPTIONS.includes(normalizeAction(actionCategory))) {
    throw new HttpsError('invalid-argument', `actionCategory must be one of ${ACTION_TAKEN_OPTIONS.join(', ')}`)
  }
  if (!notes?.trim()) {
    throw new HttpsError('invalid-argument', 'notes are required')
  }
  if (!effectiveDate) {
    throw new HttpsError('invalid-argument', 'effectiveDate is required')
  }

  const firestore = admin.firestore()
  const { caseRef, snapshot } = await loadCaseForHandler(firestore, caseId, investigatorId)
  if (!OPEN_STATUSES_ALLOWING_ACTION.includes(snapshot.data().status)) {
    throw new HttpsError('failed-precondition', 'This case is already closed')
  }

  await caseRef.update({
    proposedAction: normalizeAction(actionCategory),
    proposedActionNotes: notes.trim(),
    proposedActionEffectiveDate: admin.firestore.Timestamp.fromDate(new Date(effectiveDate)),
    proposedActionBy: investigatorId,
    proposedActionAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { success: true }
})

// Finalizes the case. Refuses to close it unless module 10's consistency
// check has actually run against the *current* proposed action - a
// proposeAction call always changes proposedActionAt, so comparing that
// against consistencyCheck.checkedAt is how this tells "checked" apart from
// "checked against an earlier, since-changed proposal". The consistency
// check result itself is advisory (a flagged case can still be closed) -
// this only gates on the check having completed, not on its outcome.
exports.closeCase = onCall(async (request) => {
  const { caseId, investigatorId } = request.data || {}
  const firestore = admin.firestore()
  const { caseRef, snapshot } = await loadCaseForHandler(firestore, caseId, investigatorId)
  const caseData = snapshot.data()

  if (!caseData.proposedAction) {
    throw new HttpsError('failed-precondition', 'Propose an action before closing this case')
  }

  const checkedAtMs = caseData.consistencyCheck?.checkedAt?.toMillis?.() ?? null
  const proposedAtMs = caseData.proposedActionAt?.toMillis?.() ?? null
  if (!checkedAtMs || !proposedAtMs || checkedAtMs < proposedAtMs) {
    throw new HttpsError(
      'failed-precondition',
      'The consistency check has not finished running against the current proposed action yet - try again shortly'
    )
  }

  await caseRef.update({
    actionTaken: caseData.proposedAction,
    actionNotes: caseData.proposedActionNotes ?? null,
    actionEffectiveDate: caseData.proposedActionEffectiveDate ?? null,
    status: 'closed',
    closedAt: admin.firestore.FieldValue.serverTimestamp(),
    closedBy: investigatorId,
  })

  return { success: true }
})
