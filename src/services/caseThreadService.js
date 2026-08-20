import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export const MESSAGE_TYPES = { MESSAGE: 'message', MANUAL_LOG: 'manual_log' }
export const SENDERS = { AI: 'ai', INVESTIGATOR: 'investigator', REPORTER: 'reporter' }

// Client-side type/size allowlist, mirroring the server allowlist in
// functions/src/utils/evidenceStorage.js. The server is the real gate - this
// exists so a file staged before any caseId or passcode exists (see
// QuestionnaireForm.jsx's staging step) can be rejected immediately, rather
// than staged, carried through submission, and only then found unacceptable
// once there is finally something to upload it against.
export const ALLOWED_EVIDENCE_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/heic', '.heic'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/rtf', '.rtf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
])
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024

// Returns a rejection message, or null if the file is acceptable. Mirrors
// requireAllowedContentType/requireAllowedSize in evidenceStorage.js closely
// enough that a file rejected here would also be rejected there, and vice
// versa - the two are meant to agree, not just both exist.
export function validateEvidenceFile(file) {
  const contentType = String(file?.type ?? '').toLowerCase()
  if (!ALLOWED_EVIDENCE_TYPES.has(contentType)) {
    return 'That file type cannot be attached. Allowed: PDF, images, plain text, CSV and Office documents.'
  }
  if (!file.size || file.size <= 0) {
    return 'That file appears to be empty.'
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return `That file is too large. The maximum attachment size is ${Math.floor(
      MAX_EVIDENCE_BYTES / (1024 * 1024)
    )}MB.`
  }
  return null
}

const getCaseThreadCallable = httpsCallable(functions, 'getCaseThread')
const getCaseThreadForHandlerCallable = httpsCallable(functions, 'getCaseThreadForHandler')
const postReporterMessageCallable = httpsCallable(functions, 'postReporterMessage')
const postInvestigatorMessageCallable = httpsCallable(functions, 'postInvestigatorMessage')
const requestEvidenceUploadUrlCallable = httpsCallable(functions, 'requestEvidenceUploadUrl')
const requestEvidenceDownloadUrlCallable = httpsCallable(functions, 'requestEvidenceDownloadUrl')
const translateMessageCallable = httpsCallable(functions, 'translateMessage')

// Cases and their messages subcollection are not client-readable or
// writable (see firestore.rules) - reporters have no Firebase Auth
// identity, only a Case ID + passcode, so every call here is a callable
// that re-verifies the passcode server-side rather than a Firestore
// listener. That also means the thread doesn't update in real time; callers
// (CaseThread.jsx) poll.
export async function getCaseThread(caseId, passcode) {
  const result = await getCaseThreadCallable({ caseId, passcode })
  // crisisFlag is scoreCase.js's server-side finding (any language), passed
  // through so CaseThread.jsx can show the same support panel a client-side
  // detection would - see that component's comment for why the two triggers
  // must render identically and record nothing.
  return { messages: result.data.messages, crisisFlag: result.data.crisisFlag === true }
}

// The staff counterpart of getCaseThread. The caller's identity comes from
// their Firebase Auth ID token (attached automatically by the Cloud
// Functions SDK) rather than a passcode - a Case Handler never holds a
// reporter's passcode.
export async function getCaseThreadForHandler(caseId) {
  const result = await getCaseThreadForHandlerCallable({ caseId })
  return result.data.messages
}

export async function sendReporterMessage(caseId, passcode, text, attachments = []) {
  if (!text?.trim() && attachments.length === 0) {
    throw new Error('Enter a message or attach a file before sending')
  }
  const result = await postReporterMessageCallable({ caseId, passcode, text, attachments })
  return result.data.messageId
}

// The caller's identity comes from their Firebase Auth ID token, which the
// Cloud Functions SDK attaches automatically - the callable reads
// request.auth.uid server-side, so no investigatorId is sent.
export async function sendInvestigatorMessage(caseId, text) {
  if (!text?.trim()) {
    throw new Error('Enter a message before sending')
  }
  const result = await postInvestigatorMessageCallable({
    caseId,
    text,
    type: MESSAGE_TYPES.MESSAGE,
  })
  return result.data.messageId
}

// Manual log entries (e.g. "called witness X, summary: ...") are their own
// message type so the UI can render them distinctly from an ordinary
// investigator message.
export async function addManualLogEntry(caseId, text) {
  if (!text?.trim()) {
    throw new Error('Enter a log entry before saving')
  }
  const result = await postInvestigatorMessageCallable({
    caseId,
    text,
    type: MESSAGE_TYPES.MANUAL_LOG,
  })
  return result.data.messageId
}

// Uploads evidence. The bucket is closed to direct client access
// (storage.rules denies read and write on case-evidence/**), so nothing here
// talks to the Storage SDK: the server validates the caller, decides the
// stored filename, checks the type and size, and hands back a signed URL good
// for at most 15 minutes. The PUT below is the only thing this client does
// with it.
//
// The storage path is still scoped only by caseId and now carries even less:
// the filename is 32 random bytes chosen server-side, so the reporter's own
// filename ("statement-from-jane.pdf") never becomes part of a path. It
// travels as a display label instead.
//
// Returns the attachment reference to pass alongside a message. It contains no
// URL by design - callers fetch a fresh one via getEvidenceDownloadUrl when a
// file is actually opened.
export async function uploadCaseEvidence(caseId, file, passcode) {
  const contentType = file.type || 'application/octet-stream'
  const { data } = await requestEvidenceUploadUrlCallable({
    caseId,
    passcode,
    contentType,
    sizeBytes: file.size,
    label: file.name,
  })

  const response = await fetch(data.uploadUrl, {
    method: 'PUT',
    // Must match the type bound into the signature, or the upload is refused.
    headers: { 'Content-Type': data.contentType },
    body: file,
  })
  if (!response.ok) {
    throw new Error('That file could not be uploaded. Please try again.')
  }

  return { fileName: data.fileName, label: file.name, contentType: data.contentType, sizeBytes: file.size }
}

// Fetches a fresh, short-lived signed URL for one attachment at the moment it
// is opened. Nothing caches the result: the URL is a bearer credential with a
// 15-minute life, so holding on to one is the thing this design exists to
// avoid. Every call is recorded in evidenceAccessLog server-side.
export async function getEvidenceDownloadUrl(caseId, fileName, passcode) {
  const { data } = await requestEvidenceDownloadUrlCallable({ caseId, fileName, passcode })
  return data.downloadUrl
}

// On-demand, per-message translation, callable from either side of the case
// thread. A Case Handler is identified by their Firebase Auth ID token, same
// as getCaseThreadForHandler - `passcode` is omitted for that path. A
// reporter has no such token, so their Case ID + passcode is sent instead;
// translateMessage.js branches on whether request.auth carries a uid to tell
// the two apart, mirroring how getCaseThread/getCaseThreadForHandler split.
export async function translateMessage(caseId, messageId, targetLang, passcode) {
  const { data } = await translateMessageCallable({ caseId, messageId, targetLang, passcode })
  return data.translation
}
