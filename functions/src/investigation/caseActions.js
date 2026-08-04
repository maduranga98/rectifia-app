const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { ACTION_TAKEN_OPTIONS, normalizeAction } = require('../consistency/actionVocabulary')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const OPEN_STATUSES_ALLOWING_ACTION = ['open', 'assigned', 'needs_manual_assignment']

// Records the Case Handler's proposed action. This write is exactly what
// checkConsistency.js's onDocumentUpdated trigger reacts to (module 10) -
// proposing an action here is what starts that check running; this
// function itself never reads or writes consistencyCheck.
exports.proposeAction = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, actionCategory, notes, effectiveDate } = request.data || {}
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
  const { caseRef, snapshot } = await loadCaseForHandler(firestore, caseId, uid)
  if (!OPEN_STATUSES_ALLOWING_ACTION.includes(snapshot.data().status)) {
    throw new HttpsError('failed-precondition', 'This case is already closed')
  }

  await caseRef.update({
    proposedAction: normalizeAction(actionCategory),
    proposedActionNotes: notes.trim(),
    proposedActionEffectiveDate: admin.firestore.Timestamp.fromDate(new Date(effectiveDate)),
    proposedActionBy: uid,
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
  const uid = requireAuthUid(request)
  const { caseId } = request.data || {}
  const firestore = admin.firestore()
  const { caseRef, snapshot } = await loadCaseForHandler(firestore, caseId, uid)
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
    closedBy: uid,
  })

  return { success: true }
})

// Records that the Case Handler has seen and considered module 10's
// consistency flag, with a short note. This is deliberately advisory-only:
// per the "flag never suggests, human decides" principle it records
// acknowledgement onto the flag itself (reviewedBy/reviewNote/reviewedAt)
// and never touches proposedAction, actionTaken, or status - reviewing a
// flag neither changes nor unblocks the handler's own decision. Writes go
// through this callable because clients cannot write cases/{caseId}
// directly (firestore.rules: allow write: if false).
exports.reviewConsistencyFlag = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, note } = request.data || {}
  if (!note?.trim()) {
    throw new HttpsError('invalid-argument', 'A review note is required')
  }

  const firestore = admin.firestore()
  const { caseRef, snapshot } = await loadCaseForHandler(firestore, caseId, uid)
  if (snapshot.data().consistencyCheck?.status !== 'flagged') {
    throw new HttpsError('failed-precondition', 'There is no consistency flag to review on this case')
  }

  // Dotted field paths merge into the existing consistencyCheck.flag map so
  // the flag's message/direction are preserved alongside the review record.
  await caseRef.update({
    'consistencyCheck.flag.reviewedBy': uid,
    'consistencyCheck.flag.reviewNote': note.trim(),
    'consistencyCheck.flag.reviewedAt': admin.firestore.FieldValue.serverTimestamp(),
  })

  return { success: true }
})
