const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')
const { buildAttachmentRecords } = require('../utils/evidenceStorage')
const {
  PUBLIC_CALLABLE_OPTIONS,
  enforceRateLimit,
  enforceCaseMessageCap,
} = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
// Every message type that can appear in a case thread. 'follow_up' is the
// retaliation follow-up module's type (functions/src/followup/*): a neutral
// post-closure check-in prompt, or the one-off notice that a new retaliation
// case was filed. It is distinct from 'ai' | 'investigator' | 'reporter' |
// 'manual_log' so CaseThread.jsx can render it differently, and it is written
// only server-side by that module - it is deliberately NOT in
// VALID_MESSAGE_TYPES below, so no client (reporter or investigator) can post a
// message that impersonates a system follow-up.
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

// An attachment on a message is metadata only - { fileName, contentType,
// sizeBytes, uploadedAt, label } - and never a URL. Evidence is fetched by
// calling requestEvidenceDownloadUrl (functions/src/intake/evidenceAccess.js)
// for a fresh 15-minute signed URL at the moment it is opened. A stored URL
// would be a permanent bearer credential sitting in Firestore, which is
// exactly what the storage lockdown removed.
//
// Documents written before that change may still carry `url`/`path` fields;
// they are dropped here on read rather than migrated, because the URLs they
// hold stopped working the moment storage.rules closed the bucket.
function serializeAttachment(attachment) {
  return {
    fileName: attachment?.fileName ?? null,
    label: attachment?.label ?? attachment?.filename ?? attachment?.fileName ?? 'Attachment',
    contentType: attachment?.contentType ?? null,
    sizeBytes: attachment?.sizeBytes ?? null,
    uploadedAt:
      typeof attachment?.uploadedAt?.toMillis === 'function' ? attachment.uploadedAt.toMillis() : null,
  }
}

// A map keyed by target language code, e.g. { si: { text, sourceLanguageGuess,
// model, translatedAt, translatedBy } } - written only by
// translateMessage.js's on-demand, investigator-only callable, never by any
// reporter-facing path. Absent entirely on a message nobody has translated,
// which is why this always returns {} rather than the raw (possibly
// undefined) field - CaseThread.jsx reads message.translations[lang]
// unconditionally.
function serializeTranslations(translations) {
  if (!translations || typeof translations !== 'object') return {}
  return Object.fromEntries(
    Object.entries(translations).map(([lang, entry]) => [
      lang,
      {
        text: entry?.text ?? '',
        sourceLanguageGuess: entry?.sourceLanguageGuess ?? null,
        model: entry?.model ?? null,
        translatedAt: typeof entry?.translatedAt?.toMillis === 'function' ? entry.translatedAt.toMillis() : null,
        translatedBy: entry?.translatedBy ?? null,
      },
    ])
  )
}

function serializeMessage(doc) {
  const data = doc.data()
  return {
    id: doc.id,
    sender: data.sender,
    type: data.type ?? 'message',
    text: data.text ?? '',
    attachments: Array.isArray(data.attachments) ? data.attachments.map(serializeAttachment) : [],
    translations: serializeTranslations(data.translations),
    // Structured payload for a 'follow_up' message: { index, kind, status,
    // answer } for a prompt, or { kind: 'new_case', newCaseId, linked } for the
    // filed-case notice. Absent (null) on every other message type. It carries
    // no free text and no passcode - the reporter's own answer text is never
    // stored on this case, and a filed case's passcode is returned once by the
    // callable, never persisted here.
    followUp: data.followUp ?? null,
    timestamp: data.timestamp ? data.timestamp.toMillis() : null,
  }
}

// Every message - AI, investigator, or reporter - lives in this one
// timeline, and reading it back is the whole audit trail; there's no
// separate log to reconcile against.
exports.getCaseThread = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { caseId, passcode } = request.data || {}
  const firestore = admin.firestore()
  // Rate limited before the passcode is checked, so the limiter itself cannot
  // be used to distinguish a real Case ID from an invented one.
  await enforceRateLimit(firestore, 'getCaseThread', request)
  const caseSnapshot = await verifyReporterAccess(firestore, caseId, passcode)

  const messagesSnapshot = await firestore
    .collection(CASES_COLLECTION)
    .doc(caseId)
    .collection(MESSAGES_SUBCOLLECTION)
    .orderBy('timestamp', 'asc')
    .get()

  // scoreCase.js's crisisFlag is written server-side by an onCreate trigger
  // that reads the case in whatever language it was submitted in - unlike
  // the client's crisisTextCheck.js, it is not English-only. Surfacing it
  // here is what lets a reporter who wrote in a language the browser check
  // can't cover still see the same support panel. See CrisisResources.jsx's
  // header comment for why nothing about this is ever logged or indicated.
  // manual_log entries are internal Case Handler notes (see
  // postInvestigatorMessage below) and must never reach the reporter -
  // getCaseThreadForHandler is the only callable allowed to return them.
  return {
    messages: messagesSnapshot.docs
      .filter((doc) => doc.data().type !== 'manual_log')
      .map(serializeMessage),
    crisisFlag: caseSnapshot.data()?.crisisFlag === true,
  }
})

// The staff counterpart of getCaseThread above. A Case Handler has a
// Firebase Auth identity, not a Case ID + passcode, so this authorises with
// loadCaseForHandler (the same assignment check postInvestigatorMessage
// uses) instead of verifyReporterAccess. It is a separate callable rather
// than a branch inside getCaseThread so the passcode check there can never
// be accidentally bypassed by an auth token.
//
// Returns the identical { messages: [...] } shape as getCaseThread, via the
// same serializeMessage, so CaseThread.jsx renders one data structure either
// way regardless of which callable produced it.
exports.getCaseThreadForHandler = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId } = request.data || {}
  const firestore = admin.firestore()
  await loadCaseForHandler(firestore, caseId, uid)

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
exports.postReporterMessage = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { caseId, passcode, text, attachments } = request.data || {}
  if (!text?.trim() && !(Array.isArray(attachments) && attachments.length > 0)) {
    throw new HttpsError('invalid-argument', 'Message text or an attachment is required')
  }

  const firestore = admin.firestore()
  await verifyReporterAccess(firestore, caseId, passcode)

  // Scoped to the case rather than the caller: this write is what fires
  // aiFollowUp.js's onCreate trigger and therefore what spends money on a
  // Claude call, and the cost belongs to the case. Limiting by caller instead
  // would let one case be driven from many networks, and would throttle
  // unrelated reporters who happen to share one.
  //
  // Both limits run only after the passcode has been verified, so a caller
  // who does not hold the case can never observe them at all - the generic
  // 'permission-denied' from verifyReporterAccess comes first either way.
  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)
  await enforceRateLimit(firestore, 'postReporterMessage', request, { scope: `case:${caseId}` })
  await enforceCaseMessageCap(caseRef)

  const attachmentRecords = await buildAttachmentRecords(firestore, caseId, attachments, 'reporter')

  const messageRef = await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'reporter',
    type: 'message',
    text: text?.trim() ?? '',
    attachments: attachmentRecords,
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

  // Same server-side verification a reporter's attachments get: the handler is
  // authenticated, but their browser is not, and an attachment record is only
  // ever built from what is genuinely in the bucket.
  const attachmentRecords = await buildAttachmentRecords(firestore, caseId, attachments, uid)

  const messageRef = await firestore
    .collection(CASES_COLLECTION)
    .doc(caseId)
    .collection(MESSAGES_SUBCOLLECTION)
    .add({
      sender: 'investigator',
      type,
      text: text.trim(),
      investigatorId: uid,
      attachments: attachmentRecords,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    })

  return { messageId: messageRef.id }
})
