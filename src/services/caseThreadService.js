import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { functions, storage } from './firebase'

export const MESSAGE_TYPES = { MESSAGE: 'message', MANUAL_LOG: 'manual_log' }
export const SENDERS = { AI: 'ai', INVESTIGATOR: 'investigator', REPORTER: 'reporter' }

const getCaseThreadCallable = httpsCallable(functions, 'getCaseThread')
const postReporterMessageCallable = httpsCallable(functions, 'postReporterMessage')
const postInvestigatorMessageCallable = httpsCallable(functions, 'postInvestigatorMessage')

// Cases and their messages subcollection are not client-readable or
// writable (see firestore.rules) - reporters have no Firebase Auth
// identity, only a Case ID + passcode, so every call here is a callable
// that re-verifies the passcode server-side rather than a Firestore
// listener. That also means the thread doesn't update in real time; callers
// (CaseThread.jsx) poll.
export async function getCaseThread(caseId, passcode) {
  const result = await getCaseThreadCallable({ caseId, passcode })
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

function randomId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Uploads evidence to Storage under a path scoped only by caseId - never
// the reporter's name, email, or passcode - so the storage path itself
// carries no identity. Returns an attachment object to pass alongside a
// reporter message.
export async function uploadCaseEvidence(caseId, file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `case-evidence/${caseId}/${randomId()}-${safeName}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, { contentType: file.type })
  const url = await getDownloadURL(storageRef)
  return { path, url, filename: file.name, contentType: file.type, size: file.size }
}
