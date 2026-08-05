const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { verifyReporterAccess } = require('../intake/caseThread')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')
const { hardDeleteCaseContent, writeDeletionLog, onLegalHold } = require('./applyRetention')

if (!admin.apps.length) {
  admin.initializeApp()
}

const NOTIFICATIONS_COLLECTION = 'notifications'
const MIN_REASON_LENGTH = 10

// The reporter-initiated erasure path (Blueprint's right-to-erasure surface),
// authenticated by Case ID + passcode exactly like postReporterMessage - a
// reporter has no other credential by design.
//
// This deliberately does NOT delete anything. An anonymous reporter cannot be
// identified, so the usual identity-verified erasure route does not apply -
// the passcode is the only proof of standing, and an open harassment
// investigation is generally processed under a legal obligation that
// survives an erasure request. Auto-deleting on demand would let a pressured
// reporter (or whoever currently holds their passcode) destroy an active
// case. Human review, with a recorded decision, is the correct handling -
// see approveDeletionRequest/declineDeletionRequest below, which are what a
// Case Handler acts on.
exports.requestCaseDeletion = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { caseId, passcode } = request.data || {}
  const firestore = admin.firestore()

  await enforceRateLimit(firestore, 'requestCaseDeletion', request, { scope: `case:${caseId}` })
  const snapshot = await verifyReporterAccess(firestore, caseId, passcode)
  const caseData = snapshot.data()

  if (caseData.deletionRequested?.status === 'pending') {
    throw new HttpsError('failed-precondition', 'A deletion request is already pending for this case')
  }

  await snapshot.ref.update({
    deletionRequested: {
      at: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    },
  })

  // Queued for functions/src/notifications/deliverNotifications.js, same
  // shape as the deadline-risk notifications it already emails to the HR
  // Coordinator - awareness only. The decision itself happens in the Case
  // Handler's workspace (approve/decline below), not here.
  if (caseData.companyId) {
    await firestore.collection(NOTIFICATIONS_COLLECTION).add({
      type: 'deletionRequestPending',
      audience: 'hrCoordinator',
      companyId: caseData.companyId,
      caseId,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  return { status: 'pending' }
})

function requireReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `A written reason of at least ${MIN_REASON_LENGTH} characters is required`
    )
  }
  return reason.trim()
}

function requirePendingRequest(caseData) {
  if (caseData.deletionRequested?.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'There is no pending deletion request on this case')
  }
}

// Approves a reporter's erasure request: permanently, immediately deletes
// this case's content via the exact same hardDeleteCaseContent a Tier 2
// retention sweep would eventually run - there is no soft delete, no
// tombstone, and no undo. Restricted to the case's assigned handler (or a
// Company Admin) via loadCaseForHandler, the same authorization
// proposeAction/closeCase use - approving an erasure request is a decision
// about the case, made by whoever is entrusted to make decisions about it.
//
// A case under legal hold cannot be approved for deletion: the hold exists
// precisely because there is a legal obligation to retain the record, and an
// erasure request does not override that - it is the scenario the hold is
// for.
exports.approveDeletionRequest = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, reason } = request.data || {}
  const cleanReason = requireReason(reason)

  const firestore = admin.firestore()
  const { caseRef, snapshot } = await loadCaseForHandler(firestore, caseId, uid)
  const caseData = snapshot.data()

  requirePendingRequest(caseData)
  if (onLegalHold(caseData)) {
    throw new HttpsError(
      'failed-precondition',
      'This case is under legal hold and cannot be deleted until the hold is released'
    )
  }

  const { messages, evidenceObjects } = await hardDeleteCaseContent(firestore, caseRef)
  await writeDeletionLog(firestore, {
    companyId: caseData.companyId ?? null,
    caseId,
    action: 'request_approved',
    actorUid: uid,
    reason: cleanReason,
    itemCounts: { messages, evidenceObjects },
  })

  return { deleted: true }
})

// Declines a reporter's erasure request. The case is untouched; the decision
// - who, when, why - is recorded on the case's own deletionRequested field
// (for CaseDetailView to show) and on deletionLog (the permanent,
// tamper-proof record). A reporter is never told an erasure request is
// guaranteed - see DeletionRequestPanel.jsx / the reporter-facing copy this
// callable's outcome feeds - and this is the callable that makes "may be
// declined" a real possibility, not just UI copy.
exports.declineDeletionRequest = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, reason } = request.data || {}
  const cleanReason = requireReason(reason)

  const firestore = admin.firestore()
  const { caseRef, snapshot } = await loadCaseForHandler(firestore, caseId, uid)
  const caseData = snapshot.data()

  requirePendingRequest(caseData)

  const decidedAt = admin.firestore.FieldValue.serverTimestamp()
  await caseRef.update({
    'deletionRequested.status': 'declined',
    'deletionRequested.decidedByUid': uid,
    'deletionRequested.decidedAt': decidedAt,
    'deletionRequested.reason': cleanReason,
  })
  await writeDeletionLog(firestore, {
    companyId: caseData.companyId ?? null,
    caseId,
    action: 'request_declined',
    actorUid: uid,
    reason: cleanReason,
    itemCounts: { messages: 0, evidenceObjects: 0 },
  })

  return { status: 'declined' }
})
