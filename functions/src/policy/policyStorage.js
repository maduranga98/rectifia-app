const { HttpsError } = require('firebase-functions/v2/https')
const { defineInt } = require('firebase-functions/params')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Storage primitives for company policy documents. Everything that touches the
// bucket for a policy lives here, mirroring functions/src/utils/evidenceStorage.js
// so the two paths reason the same way: a closed bucket, a sanitised path, an
// allowlisted content type, and a hard size ceiling checked against the real
// object after the fact.
//
// storage.rules denies every direct client read and write under
// company-policies/**. The only way bytes get in or out is a short-lived V4
// signed URL minted here after policyAccess.js has proved the caller is a
// Company Admin of the owning company. Signing requires the runtime service
// account to hold roles/iam.serviceAccountTokenCreator on itself, exactly as
// the evidence path documents.
const POLICY_PREFIX = 'company-policies'

const MAX_SIGNED_URL_TTL_MINUTES = 15
const signedUrlTtlMinutes = defineInt('POLICY_SIGNED_URL_TTL_MINUTES', { default: 15 })

// 10MB. A written policy document is prose, not media - a harassment policy or
// a disciplinary procedure is a handful of pages - so the ceiling is well below
// the evidence limit. Deploy-time config so a company with an unusually long
// combined handbook can be accommodated without a code change.
const maxPolicyBytes = defineInt('POLICY_MAX_BYTES', { default: 10 * 1024 * 1024 })

// A deliberately narrow allowlist: the four formats a company's own written
// policy actually arrives as. No images, no spreadsheets, no archives - a
// policy document is text, and everything downstream (ingestPolicyDocument.js)
// only knows how to extract text from exactly these. The value is the canonical
// extension used to build the stored file name.
const ALLOWED_CONTENT_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['text/plain', '.txt'],
  ['text/markdown', '.md'],
])

// A markdown file is very commonly served as text/plain by browsers, so a
// .md upload may arrive under either type. This maps the *declared* extension
// back to how ingestPolicyDocument.js should treat the bytes.
const EXTENSION_KINDS = new Map([
  ['.pdf', 'pdf'],
  ['.docx', 'docx'],
  ['.txt', 'text'],
  ['.md', 'text'],
])

// companyId and policyId are both server-generated ids on this path, but the
// object path is the entire access boundary once the bucket is closed, so
// neither is concatenated on trust. The shape is Firestore's own auto-id /
// company doc id vocabulary: letters, digits, hyphen, underscore.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function ttlMs() {
  const configured = Number(signedUrlTtlMinutes.value())
  const minutes = Number.isFinite(configured) && configured > 0
    ? Math.min(configured, MAX_SIGNED_URL_TTL_MINUTES)
    : MAX_SIGNED_URL_TTL_MINUTES
  return minutes * 60 * 1000
}

function maxBytes() {
  const configured = Number(maxPolicyBytes.value())
  return Number.isFinite(configured) && configured > 0 ? configured : 10 * 1024 * 1024
}

// Throws unless the content type is on the allowlist. Returns the canonical
// content type, its extension, and the extraction kind ingest should use.
function requireAllowedContentType(contentType) {
  const normalized = String(contentType ?? '').toLowerCase().split(';')[0].trim()
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) {
    throw new HttpsError(
      'invalid-argument',
      'That file type cannot be uploaded as a policy. Allowed: PDF, DOCX, TXT and Markdown.'
    )
  }
  const extension = ALLOWED_CONTENT_TYPES.get(normalized)
  return { contentType: normalized, extension, kind: EXTENSION_KINDS.get(extension) }
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
      `That file is too large. The maximum policy document size is ${Math.floor(limit / (1024 * 1024))}MB.`
    )
  }
  return size
}

// Unlike evidence, a policy document's own filename is *useful* - an admin
// picks a document out of a table by "harassment-policy-2024.pdf", not a hex
// string - so it is preserved, but sanitised hard first. The client name is
// reduced to its basename (no directory components survive), stripped of
// anything that is not a safe display/path character, collapsed, length-capped,
// and given a fallback if nothing survives. It can therefore never carry a
// slash, a `..`, a leading dot, or a control character into the storage path.
function sanitiseFileName(rawName, extension) {
  const base = String(rawName ?? '')
    .split(/[\\/]/)
    .pop()
    .trim()
  const stripped = base
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  const safe = stripped || `policy${extension ?? ''}`
  // Guarantee the canonical extension is present exactly once so the object
  // opens in the right application and ingest can trust it.
  if (extension && !safe.toLowerCase().endsWith(extension)) {
    return `${safe}${extension}`
  }
  return safe
}

function requireId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new HttpsError('invalid-argument', `${label} is required`)
  }
  return value
}

// Builds the storage path. Both ids are validated (never concatenated on
// trust) and the file name is validated to the exact shape sanitiseFileName
// produces, so nothing can climb out of this policy's own prefix.
function policyPath(companyId, policyId, fileName) {
  requireId(companyId, 'companyId')
  requireId(policyId, 'policyId')
  if (typeof fileName !== 'string' || fileName.length === 0 || /[\\/]/.test(fileName) || fileName.includes('..')) {
    throw new HttpsError('invalid-argument', 'Unknown policy file')
  }
  return `${POLICY_PREFIX}/${companyId}/${policyId}/${fileName}`
}

function bucket() {
  return admin.storage().bucket()
}

// Mints a write-only signed URL for exactly one new object under this policy's
// prefix. The content type is bound into the signature, so the PUT must send
// exactly the validated type.
async function createUploadUrl(companyId, policyId, rawFileName, { contentType, extension }) {
  const fileName = sanitiseFileName(rawFileName, extension)
  const storagePath = policyPath(companyId, policyId, fileName)
  const expiresAt = Date.now() + ttlMs()
  const [url] = await bucket()
    .file(storagePath)
    .getSignedUrl({ version: 'v4', action: 'write', expires: expiresAt, contentType })
  return { fileName, storagePath, uploadUrl: url, contentType, expiresAt }
}

async function createDownloadUrl(storagePath) {
  const expiresAt = Date.now() + ttlMs()
  const [url] = await bucket()
    .file(storagePath)
    .getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt })
  return { downloadUrl: url, expiresAt }
}

async function deletePolicyObject(storagePath) {
  if (!storagePath) return
  await bucket().file(storagePath).delete({ ignoreNotFound: true })
}

module.exports = {
  POLICY_PREFIX,
  MAX_SIGNED_URL_TTL_MINUTES,
  ALLOWED_CONTENT_TYPES,
  EXTENSION_KINDS,
  maxBytes,
  requireAllowedContentType,
  requireAllowedSize,
  sanitiseFileName,
  policyPath,
  createUploadUrl,
  createDownloadUrl,
  deletePolicyObject,
}
