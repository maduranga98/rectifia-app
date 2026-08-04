const { HttpsError } = require('firebase-functions/v2/https')
const { defineInt } = require('firebase-functions/params')
const admin = require('firebase-admin')
const crypto = require('crypto')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Storage primitives for case evidence. Everything that actually touches the
// bucket lives here rather than in the callables (evidenceAccess.js) so that
// caseThread.js can re-verify an uploaded object before recording it on a
// message without importing the callables module - caseThread.js exports
// verifyReporterAccess, which evidenceAccess.js needs, and a direct
// caseThread <-> evidenceAccess pair would be a require cycle.
//
// storage.rules denies every direct client read and write under
// case-evidence/**. The only way bytes get in or out is a short-lived V4
// signed URL minted here after the caller has proved they hold the case (Case
// ID + passcode for a reporter, Firebase Auth + assignment for a handler).
//
// Signing requires the runtime service account to be able to sign blobs. On
// Cloud Functions that means the default compute service account needs
// roles/iam.serviceAccountTokenCreator on itself; without it getSignedUrl
// fails at runtime with a signBlob permission error.
const EVIDENCE_PREFIX = 'case-evidence'
const EVIDENCE_ACCESS_LOG_COLLECTION = 'evidenceAccessLog'

// A signed URL is a bearer credential: whoever holds the string holds the
// file. 15 minutes is the ceiling, not a suggestion - it is long enough to
// start a download on a bad connection and short enough that a URL leaked
// into a proxy log or a chat message is dead before it is useful. It is never
// persisted anywhere (see the attachment shape in caseThread.js).
const MAX_SIGNED_URL_TTL_MINUTES = 15
const signedUrlTtlMinutes = defineInt('EVIDENCE_SIGNED_URL_TTL_MINUTES', { default: 15 })

// Default 25MB. Deploy-time config rather than a constant so a company with a
// genuine need for larger evidence can be accommodated without a code change.
const maxEvidenceBytes = defineInt('EVIDENCE_MAX_BYTES', { default: 25 * 1024 * 1024 })

// An allowlist, deliberately - documents, images, plain text and PDF, which is
// what evidence in a workplace case actually looks like. Everything else is
// refused, so executables (application/x-msdownload, application/x-sh, ...)
// and archives (application/zip, application/x-7z-compressed, ...) are
// rejected by omission rather than by a blocklist that a new MIME type can
// walk straight past. The extension is only cosmetic - it is appended to the
// server-generated name so a downloaded file opens in the right application.
const ALLOWED_CONTENT_TYPES = new Map([
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

// The server-generated name is 32 random bytes in hex plus an extension. The
// client's own filename never reaches the storage path: a reporter-chosen
// name can carry the reporter's identity ("my-resignation-letter-jane.pdf"),
// a path traversal, or simply be guessable, and the path is the only thing
// standing between a leaked object name and the file. The original name is
// kept purely as a display label on the message document.
const STORED_NAME_PATTERN = /^[0-9a-f]{64}(\.[a-z0-9]{1,8})?$/

// The shape generateCaseAccess.js's randomCaseId produces (RC-YYYY-NNNN),
// kept deliberately loose on length so an id format change does not silently
// break evidence, but strict on the characters that matter: no slashes, no
// dots, nothing that can climb out of the case's own prefix.
const CASE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

function ttlMs() {
  const configured = Number(signedUrlTtlMinutes.value())
  const minutes = Number.isFinite(configured) && configured > 0
    ? Math.min(configured, MAX_SIGNED_URL_TTL_MINUTES)
    : MAX_SIGNED_URL_TTL_MINUTES
  return minutes * 60 * 1000
}

function maxBytes() {
  const configured = Number(maxEvidenceBytes.value())
  return Number.isFinite(configured) && configured > 0 ? configured : 25 * 1024 * 1024
}

// Throws unless the content type is on the allowlist. Returns the extension to
// append to the generated name.
function requireAllowedContentType(contentType) {
  const normalized = String(contentType ?? '').toLowerCase().split(';')[0].trim()
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) {
    throw new HttpsError(
      'invalid-argument',
      'That file type cannot be attached. Allowed: PDF, images, plain text, CSV and Office documents.'
    )
  }
  return { contentType: normalized, extension: ALLOWED_CONTENT_TYPES.get(normalized) }
}

function requireAllowedSize(sizeBytes) {
  const size = Number(sizeBytes)
  if (!Number.isFinite(size) || size <= 0) {
    throw new HttpsError('invalid-argument', 'A valid file size is required')
  }
  const limit = maxBytes()
  if (size > limit) {
    throw new HttpsError(
      'invalid-argument',
      `That file is too large. The maximum attachment size is ${Math.floor(limit / (1024 * 1024))}MB.`
    )
  }
  return size
}

function generateStoredFileName(extension) {
  return `${crypto.randomBytes(32).toString('hex')}${extension ?? ''}`
}

// A stored file name is only ever one this module generated, so anything that
// does not match that exact shape is rejected before it is concatenated into a
// path. That is what stops "../../other-case/secret.pdf" from becoming a
// readable object, and it is checked on every read rather than trusted from
// whatever was written onto the message document.
// Both halves of the path are validated, not just the file name. In practice
// the caller has already proved this case exists (verifyReporterAccess or
// loadCaseForHandler run first, and a caseId containing a slash would not be a
// valid Firestore document path anyway), but the object path is the entire
// access boundary now that the bucket is closed, so neither half is
// concatenated on trust.
function evidencePath(caseId, fileName) {
  if (typeof caseId !== 'string' || !CASE_ID_PATTERN.test(caseId)) {
    throw new HttpsError('invalid-argument', 'caseId is required')
  }
  if (typeof fileName !== 'string' || !STORED_NAME_PATTERN.test(fileName)) {
    throw new HttpsError('invalid-argument', 'Unknown attachment')
  }
  return `${EVIDENCE_PREFIX}/${caseId}/${fileName}`
}

function bucket() {
  return admin.storage().bucket()
}

// Mints a write-only signed URL for one specific, server-named object. The
// content type is bound into the signature, so the PUT must send exactly the
// type that was validated here - a caller cannot get a URL approved for
// image/png and then upload an executable through it.
async function createUploadUrl(caseId, { contentType, extension }) {
  const fileName = generateStoredFileName(extension)
  const expiresAt = Date.now() + ttlMs()
  const [url] = await bucket()
    .file(evidencePath(caseId, fileName))
    .getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType })
  return { fileName, uploadUrl: url, contentType, expiresAt }
}

async function createDownloadUrl(caseId, fileName) {
  const expiresAt = Date.now() + ttlMs()
  const [url] = await bucket()
    .file(evidencePath(caseId, fileName))
    .getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt })
  return { downloadUrl: url, expiresAt }
}

// Reads what is *actually* in the bucket. A signed upload URL can bind the
// content type but cannot cap the number of bytes pushed through it, so the
// size limit is only genuinely enforced once the object exists - which is
// here, called by caseThread.js before an attachment is recorded on a message
// and by the download callable before a URL is issued. The values returned are
// the ones stored, never the client's claims about its own file.
async function verifyEvidenceObject(caseId, fileName) {
  const file = bucket().file(evidencePath(caseId, fileName))
  let metadata
  try {
    const [meta] = await file.getMetadata()
    metadata = meta
  } catch (err) {
    if (err?.code === 404) {
      throw new HttpsError('not-found', 'That attachment could not be found')
    }
    throw err
  }

  const { contentType } = requireAllowedContentType(metadata.contentType)
  const sizeBytes = requireAllowedSize(Number(metadata.size))
  return { fileName, contentType, sizeBytes }
}

async function deleteEvidenceObject(caseId, fileName) {
  await bucket()
    .file(evidencePath(caseId, fileName))
    .delete({ ignoreNotFound: true })
}

// Every issued upload URL and every issued download URL is recorded, in the
// same shape and for the same reason as triageAccessLog in
// functions/src/investigation/getCaseForTriage.js: reading evidence is acting
// on a case, so it is an audited event. `actor` is a staff uid or the literal
// 'reporter' - a reporter has no identity to record and recording one would
// undo the anonymity the rest of the system is built around.
//
// firestore.rules denies all client access to this collection, including
// Super Admin: a mutable audit trail is not an audit trail.
async function logEvidenceAccess(firestore, { caseId, companyId, actor, action, fileName, outcome }) {
  await firestore.collection(EVIDENCE_ACCESS_LOG_COLLECTION).add({
    caseId: caseId ?? null,
    companyId: companyId ?? null,
    actor,
    action,
    fileName: fileName ?? null,
    outcome,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Turns the file names a client claims to have uploaded into attachment
// records built entirely from server-side facts. Called by caseThread.js
// before a message is written. Anything that is not a real object under this
// case's prefix, or that fails the size / content-type rules once its actual
// bytes are in the bucket, is rejected - and the offending object is removed
// rather than left orphaned in the bucket where nothing references it and
// nothing will ever clean it up.
//
// This lives here rather than in evidenceAccess.js purely to keep the module
// graph acyclic: evidenceAccess.js imports verifyReporterAccess from
// caseThread.js, so caseThread.js cannot import from evidenceAccess.js.
async function buildAttachmentRecords(firestore, caseId, attachments, actor) {
  if (!Array.isArray(attachments) || attachments.length === 0) return []

  const records = []
  for (const attachment of attachments) {
    const fileName = attachment?.fileName
    let verified
    try {
      verified = await verifyEvidenceObject(caseId, fileName)
    } catch (err) {
      await deleteEvidenceObject(caseId, fileName).catch(() => {})
      await logEvidenceAccess(firestore, {
        caseId,
        companyId: null,
        actor,
        action: 'attachment_rejected',
        fileName: typeof fileName === 'string' ? fileName : null,
        outcome: err instanceof HttpsError ? `denied:${err.code}` : 'denied:internal',
      }).catch(() => {})
      throw err
    }

    // Exactly these fields reach Firestore. No URL is stored: a signed URL is
    // a bearer credential with a 15-minute life, and persisting one would both
    // outlive its own expiry as a record and defeat the point of the expiry.
    records.push({
      fileName: verified.fileName,
      contentType: verified.contentType,
      sizeBytes: verified.sizeBytes,
      uploadedAt: admin.firestore.Timestamp.now(),
      // The uploader's own filename, kept only so the UI has something
      // readable to show. It is never part of a storage path.
      label:
        typeof attachment?.label === 'string' && attachment.label.trim()
          ? attachment.label.trim().slice(0, 200)
          : verified.fileName,
    })
  }
  return records
}

module.exports = {
  EVIDENCE_PREFIX,
  EVIDENCE_ACCESS_LOG_COLLECTION,
  MAX_SIGNED_URL_TTL_MINUTES,
  ALLOWED_CONTENT_TYPES,
  maxBytes,
  requireAllowedContentType,
  requireAllowedSize,
  evidencePath,
  createUploadUrl,
  createDownloadUrl,
  verifyEvidenceObject,
  deleteEvidenceObject,
  logEvidenceAccess,
  buildAttachmentRecords,
}
