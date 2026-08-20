import { httpsCallable } from 'firebase/functions'
import { auth, functions } from './firebase'

// Module 27's client boundary. externalShares/externalAccessLog are both
// fully sealed in firestore.rules - even for Super Admin - so every read and
// write here goes through a callable. Two of these four are reached by a
// signed-in Case Handler (create/list); revoke is reached by a Case Handler
// or Super Admin; getSharedCase is the one unauthenticated call in this
// whole app that is not the reporter's Case ID + passcode flow.
const createExternalShareCallable = httpsCallable(functions, 'createExternalShare')
const listCaseSharesCallable = httpsCallable(functions, 'listCaseShares')
const revokeExternalShareCallable = httpsCallable(functions, 'revokeExternalShare')
const getSharedCaseCallable = httpsCallable(functions, 'getSharedCase')
const accessSharedEvidenceCallable = httpsCallable(functions, 'accessSharedEvidence')
// Module 49's review queue. submitExternalComment is unauthenticated, same
// as getSharedCase/accessSharedEvidence; listExternalComments and
// reviewExternalComment are the assigned Case Handler's own tools, gated by
// requireHandlerUid() below like createExternalShare/listCaseShares/
// revokeExternalShare.
const submitExternalCommentCallable = httpsCallable(functions, 'submitExternalComment')
const listExternalCommentsCallable = httpsCallable(functions, 'listExternalComments')
const reviewExternalCommentCallable = httpsCallable(functions, 'reviewExternalComment')

// Mirrors MIN_PURPOSE_LENGTH in functions/src/sharing/createShare.js -
// duplicated to gate the form and message the requirement; the server
// enforces the real minimum.
export const MIN_PURPOSE_LENGTH = 20
export const MAX_EXPIRES_DAYS = 30
export const DEFAULT_EXPIRES_DAYS = 14
export const MAX_ACTIVE_SHARES_PER_CASE = 3

export const SCOPE_LABELS = {
  summary: 'Summary (scores, dates, action taken, compliance log)',
  full: 'Full record (adds the message thread)',
}

function requireHandlerUid() {
  const uid = auth.currentUser?.uid
  if (!uid) {
    throw new Error('You must be signed in as a Case Handler to do this')
  }
  return uid
}

export async function createExternalShare(caseId, {
  recipientName,
  recipientEmail,
  recipientOrganisation,
  purpose,
  expiresInDays,
  scope,
  sharedEvidence,
}) {
  requireHandlerUid()
  const result = await createExternalShareCallable({
    caseId,
    recipientName,
    recipientEmail,
    recipientOrganisation,
    purpose,
    expiresInDays,
    scope,
    // Omitted entirely (rather than sent as []) when nothing was selected -
    // the server default is already an empty array, and this keeps the
    // common case's request payload identical to what it was before this
    // field existed.
    ...(Array.isArray(sharedEvidence) && sharedEvidence.length > 0 ? { sharedEvidence } : {}),
  })
  return result.data
}

export async function listCaseShares(caseId) {
  requireHandlerUid()
  const result = await listCaseSharesCallable({ caseId })
  return result.data.shares
}

export async function revokeExternalShare(shareId, reason) {
  requireHandlerUid()
  const result = await revokeExternalShareCallable({ shareId, reason })
  return result.data
}

// Unauthenticated - no requireHandlerUid guard, deliberately. acceptedName
// is only meaningful on the first successful call for a share that has not
// yet recorded an acceptance; omit it on every call after that.
export async function getSharedCase({ shareId, token, acceptedName }) {
  const result = await getSharedCaseCallable({ shareId, token, acceptedName })
  return result.data
}

// The evidence-opening counterpart of getSharedCase - also unauthenticated,
// also deliberately: the token in the URL is the entire credential, exactly
// as it is for the rest of this shared view. Mints a fresh, short-lived
// signed URL for one file already in this share's allowlist; nothing here
// stores the result, matching how getEvidenceDownloadUrl in
// caseThreadService.js is used from CaseThread.jsx and CaseEvidencePanel.jsx.
export async function getSharedEvidenceDownloadUrl(shareId, token, fileName) {
  const result = await accessSharedEvidenceCallable({ shareId, token, fileName })
  return result.data.downloadUrl
}

// Unauthenticated, deliberately - the recipient sending feedback back is the
// same holder-of-the-token as the rest of this view, never signed in.
export async function submitExternalComment(shareId, token, text) {
  const result = await submitExternalCommentCallable({ shareId, token, text })
  return result.data
}

export async function listExternalComments(caseId) {
  requireHandlerUid()
  const result = await listExternalCommentsCallable({ caseId })
  return result.data.comments
}

export async function reviewExternalComment(commentId, action, text) {
  requireHandlerUid()
  const result = await reviewExternalCommentCallable({ commentId, action, text })
  return result.data
}
