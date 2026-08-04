const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
const VALID_MESSAGE_TYPES = ['message', 'manual_log']
const SCRYPT_KEY_LENGTH = 64

// Cases (and their subcollections) are not client-readable or writable -
// see firestore.rules. Reporters have no Firebase Auth identity, only a
// Case ID + passcode, so every reporter-facing call here re-verifies the
// passcode against the salted hash, the same stateless check
// generateCaseAccess.js's validateCaseAccess uses.
function hashPasscode(passcode, salt) {
  return crypto.scryptSync(passcode, salt, SCRYPT_KEY_LENGTH).toString('hex')
}

async function verifyReporterAccess(firestore, caseId, passcode) {
  if (!caseId || !passcode) {
    throw new HttpsError('invalid-argument', 'Case ID and passcode are required')
  }

  const snapshot = await firestore.collection(CASES_COLLECTION).doc(caseId).get()
  if (!snapshot.exists) {
    throw new HttpsError('permission-denied', 'Invalid Case ID or passcode')
  }

  const { passcodeHash, passcodeSalt } = snapshot.data()
  const candidateHash = hashPasscode(passcode, passcodeSalt)
  const expected = Buffer.from(passcodeHash, 'hex')
  const candidate = Buffer.from(candidateHash, 'hex')
  const matches = expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)

  if (!matches) {
    throw new HttpsError('permission-denied', 'Invalid Case ID or passcode')
  }

  return snapshot
}
// Exported so other reporter-facing callables (e.g.
// functions/src/notifications/sendCaseUpdate.js's registerPushSubscription)
// can reuse the exact same passcode check instead of duplicating it.
exports.verifyReporterAccess = verifyReporterAccess

function serializeMessage(doc) {
  const data = doc.data()
  return {
    id: doc.id,
    sender: data.sender,
    type: data.type ?? 'message',
    text: data.text ?? '',
    attachments: data.attachments ?? [],
    timestamp: data.timestamp ? data.timestamp.toMillis() : null,
  }
}

// Every message - AI, investigator, or reporter - lives in this one
// timeline, and reading it back is the whole audit trail; there's no
// separate log to reconcile against.
exports.getCaseThread = onCall(async (request) => {
  const { caseId, passcode } = request.data || {}
  const firestore = admin.firestore()
  await verifyReporterAccess(firestore, caseId, passcode)

  const messagesSnapshot = await firestore
    .collection(CASES_COLLECTION)
    .doc(caseId)
    .collection(MESSAGES_SUBCOLLECTION)
    .orderBy('timestamp', 'asc')
    .get()

  return { messages: messagesSnapshot.docs.map(serializeMessage) }
})

// Posts a reporter message. This write is what aiFollowUp.js's onCreate
// trigger reacts to - it's the only path through which new evidence reaches
// a case after the original questionnaire submission.
exports.postReporterMessage = onCall(async (request) => {
  const { caseId, passcode, text, attachments } = request.data || {}
  if (!text?.trim() && !(Array.isArray(attachments) && attachments.length > 0)) {
    throw new HttpsError('invalid-argument', 'Message text or an attachment is required')
  }

  const firestore = admin.firestore()
  await verifyReporterAccess(firestore, caseId, passcode)

  const messageRef = await firestore
    .collection(CASES_COLLECTION)
    .doc(caseId)
    .collection(MESSAGES_SUBCOLLECTION)
    .add({
      sender: 'reporter',
      type: 'message',
      text: text?.trim() ?? '',
      attachments: Array.isArray(attachments) ? attachments : [],
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { messageId: messageRef.id }
})

// Posts an investigator message or a manual log entry ('manual_log' is kept
// as a distinct `type` so the UI can render it differently from ordinary
// messages). The investigator's identity is taken from the verified Firebase
// Auth token (request.auth.uid), never a client-supplied field: the caller
// must be an authenticated caseHandler/companyAdmin assigned to this case.
exports.postInvestigatorMessage = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, text, type = 'message', attachments } = request.data || {}
  if (!text?.trim()) {
    throw new HttpsError('invalid-argument', 'Message text is required')
  }
  if (!VALID_MESSAGE_TYPES.includes(type)) {
    throw new HttpsError('invalid-argument', `type must be one of ${VALID_MESSAGE_TYPES.join(', ')}`)
  }

  const firestore = admin.firestore()
  await loadCaseForHandler(firestore, caseId, uid)

  const messageRef = await firestore
    .collection(CASES_COLLECTION)
    .doc(caseId)
    .collection(MESSAGES_SUBCOLLECTION)
    .add({
      sender: 'investigator',
      type,
      text: text.trim(),
      investigatorId: uid,
      attachments: Array.isArray(attachments) ? attachments : [],
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { messageId: messageRef.id }
})
