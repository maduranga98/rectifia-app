const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { verifyReporterAccess } = require('./caseThread')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')
const {
  requireAllowedContentType,
  requireAllowedSize,
  createUploadUrl,
  createDownloadUrl,
  verifyEvidenceObject,
  logEvidenceAccess,
} = require('../utils/evidenceStorage')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'

// Evidence files used to be uploaded straight from the browser to Cloud
// Storage and read back through a permanent download URL, with storage.rules
// allowing `read, write: if true` on case-evidence/{caseId}/{fileName}. That
// made every uploaded file world-readable to anyone who could guess a Case ID
// and world-writable to anyone at all - and the download URLs, once minted,
// never expired and were stored in Firestore where they became a second copy
// of the credential.
//
// storage.rules now denies all direct client access to case-evidence/**.
// These two callables are the entire way in and out: they validate the caller
// against the same access rules the rest of the case does, then hand back a
// signed URL that is good for at most 15 minutes and is never persisted.
//
// Files uploaded under the old open rule are unreachable by their old URLs.
// That is the point of the change, and there is deliberately no compatibility
// path keeping the open rule alive for them.

// The one access check, shared by both callables. A reporter proves the case
// is theirs with Case ID + passcode (verifyReporterAccess, unchanged and
// unduplicated); a staff member proves it with a Firebase Auth token plus the
// assignment check in loadCaseForHandler. Which branch applies is decided by
// whether the call carries an auth token, never by a client-supplied flag.
//
// Returns the actor string written to the audit log and the case's companyId.
async function authorizeCaseAccess(firestore, request, caseId) {
  if (request.auth?.uid) {
    const uid = requireAuthUid(request)
    const { snapshot } = await loadCaseForHandler(firestore, caseId, uid)
    return { actor: uid, companyId: snapshot.data().companyId ?? null }
  }

  const { passcode } = request.data || {}
  const snapshot = await verifyReporterAccess(firestore, caseId, passcode)
  // 'reporter' rather than any identifier: the audit trail records that the
  // holder of the passcode acted, which is all it can honestly record and all
  // an anonymous-tier case has to give.
  return { actor: 'reporter', companyId: snapshot.data().companyId ?? null }
}

// Issues a short-lived, write-only signed URL for exactly one new object under
// this case's prefix.
//
// The stored file name is generated here from 32 random bytes - the client's
// filename is accepted only as a display label and never becomes part of a
// storage path. The content type is validated against the allowlist and then
// bound into the signature, so the URL cannot be reused to push a different
// kind of file. The declared size is checked here; the real size is checked
// against the bucket before the attachment is recorded on a message
// (verifyEvidenceObject, called from caseThread.js), because a signed URL
// cannot cap bytes on its own.
exports.requestEvidenceUploadUrl = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { caseId, contentType, sizeBytes, label } = request.data || {}
  const firestore = admin.firestore()

  await enforceRateLimit(firestore, 'requestEvidenceUploadUrl', request)

  let actor = 'reporter'
  let companyId = null
  try {
    const authorized = await authorizeCaseAccess(firestore, request, caseId)
    actor = authorized.actor
    companyId = authorized.companyId

    const allowed = requireAllowedContentType(contentType)
    requireAllowedSize(sizeBytes)

    const upload = await createUploadUrl(caseId, allowed)

    await logEvidenceAccess(firestore, {
      caseId,
      companyId,
      actor,
      action: 'upload_url_issued',
      fileName: upload.fileName,
      outcome: 'granted',
    })

    return {
      fileName: upload.fileName,
      uploadUrl: upload.uploadUrl,
      contentType: upload.contentType,
      expiresAt: upload.expiresAt,
      // Echoed back so the caller can carry it onto the message document as a
      // display label without having to hold it separately.
      label: typeof label === 'string' ? label.slice(0, 200) : null,
    }
  } catch (err) {
    await logEvidenceAccess(firestore, {
      caseId: caseId ?? null,
      companyId,
      actor,
      action: 'upload_url_issued',
      fileName: null,
      outcome: err instanceof HttpsError ? `denied:${err.code}` : 'denied:internal',
    }).catch(() => {})
    throw err
  }
})

// Issues a short-lived read URL for one named file on one case. The caller
// must pass the same access check as the upload path; the file name must match
// the shape this system generates (evidencePath rejects anything else, which
// is what stops a traversal out of the case's own prefix); and the object must
// still satisfy the size and content-type rules, so a file that slipped past
// the upload check cannot be read back out.
exports.requestEvidenceDownloadUrl = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { caseId, fileName } = request.data || {}
  const firestore = admin.firestore()

  await enforceRateLimit(firestore, 'requestEvidenceDownloadUrl', request)

  let actor = 'reporter'
  let companyId = null
  try {
    const authorized = await authorizeCaseAccess(firestore, request, caseId)
    actor = authorized.actor
    companyId = authorized.companyId

    await verifyEvidenceObject(caseId, fileName)
    const { downloadUrl, expiresAt } = await createDownloadUrl(caseId, fileName)

    await logEvidenceAccess(firestore, {
      caseId,
      companyId,
      actor,
      action: 'download_url_issued',
      fileName,
      outcome: 'granted',
    })

    return { downloadUrl, expiresAt }
  } catch (err) {
    await logEvidenceAccess(firestore, {
      caseId: caseId ?? null,
      companyId,
      actor,
      action: 'download_url_issued',
      fileName: typeof fileName === 'string' ? fileName : null,
      outcome: err instanceof HttpsError ? `denied:${err.code}` : 'denied:internal',
    }).catch(() => {})
    throw err
  }
})

exports.CASES_COLLECTION = CASES_COLLECTION
exports.authorizeCaseAccess = authorizeCaseAccess
