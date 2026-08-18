const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  POLICY_PREFIX,
  requireAllowedContentType,
  requireAllowedSize,
  createUploadUrl,
  createDownloadUrl,
} = require('./policyStorage')
const { enforceRateLimit } = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

const POLICIES_COLLECTION = 'companyPolicies'

// Roles allowed to *download* a policy document. Upload is Company Admin only -
// they own the source of truth for their company's written rules - but the
// investigation roles need to open the clause a case was grounded against, so
// PolicyReferences.jsx can link straight to it. This never widens Company
// Admin's access to case content: it only lets the two investigation roles
// read a policy document, which is company structure, not a case.
const DOWNLOAD_ROLES = ['companyAdmin', 'caseHandler', 'hrCoordinator']

// The company is always the caller's own, taken from the Firebase Auth custom
// claim rather than the request body - a client-supplied companyId would let a
// Company Admin of one company upload into another's policy shelf. loadCallerRole
// then re-checks that claim against the staff subcollection, so a stale claim on
// a deactivated account still fails.
async function callerCompanyAndRole(firestore, request, action) {
  const uid = requireAuthUid(request)
  const companyId = request.auth?.token?.companyId
  if (!companyId) {
    throw new HttpsError(
      'permission-denied',
      'Your account is not linked to a company'
    )
  }
  const role = await loadCallerRole(firestore, companyId, uid, action)
  return { uid, companyId, role }
}

// Next version number for a document title within a company, and the prior
// active version documents that this upload supersedes. Versioning is
// immutable-forward: a re-upload of an existing title becomes version N+1, and
// the prior version is archived (never deleted) once the new one is live, so a
// closed case's report still resolves the exact clauses in effect when it was
// created. The archiving itself happens in ingestPolicyDocument.js on success -
// archiving here, before the bytes are even extracted, would retire a working
// policy in favour of one that might fail to process.
async function nextVersionForTitle(firestore, companyId, title) {
  const snapshot = await firestore
    .collection(POLICIES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('title', '==', title)
    .get()
  let maxVersion = 0
  snapshot.forEach((doc) => {
    const version = Number(doc.data().version)
    if (Number.isFinite(version) && version > maxVersion) maxVersion = version
  })
  return maxVersion + 1
}

// Issues a short-lived, write-only signed URL for one new policy object and
// creates its companyPolicies/{policyId} document in 'processing'. The Storage
// onObjectFinalized trigger (ingestPolicyDocument.js) takes over once the bytes
// land: it extracts, chunks, and flips the status to 'active' or 'failed'.
exports.requestPolicyUploadUrl = onCall(async (request) => {
  const firestore = admin.firestore()

  await enforceRateLimit(firestore, 'requestPolicyUploadUrl', request)

  const { companyId, role, uid } = await callerCompanyAndRole(firestore, request, 'policy_upload_url')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'policy_upload_url',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may upload policy documents')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'policy_upload_url', outcome: 'granted' })

  const { title, fileName, contentType, sizeBytes } = request.data || {}
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 200) : ''
  if (!cleanTitle) {
    throw new HttpsError('invalid-argument', 'A document title is required')
  }

  const allowed = requireAllowedContentType(contentType)
  requireAllowedSize(sizeBytes)

  const version = await nextVersionForTitle(firestore, companyId, cleanTitle)

  const docRef = firestore.collection(POLICIES_COLLECTION).doc()
  const policyId = docRef.id

  const upload = await createUploadUrl(companyId, policyId, fileName, allowed)

  await docRef.set({
    companyId,
    title: cleanTitle,
    fileName: upload.fileName,
    storagePath: upload.storagePath,
    mimeType: upload.contentType,
    sizeBytes: Number(sizeBytes),
    status: 'processing',
    version,
    uploadedByUid: uid,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    chunkCount: 0,
    categoriesCovered: [],
    errorMessage: null,
  })

  return {
    policyId,
    fileName: upload.fileName,
    uploadUrl: upload.uploadUrl,
    contentType: upload.contentType,
    version,
    expiresAt: upload.expiresAt,
  }
})

// Issues a short-lived read URL for one policy document. The caller must be a
// staff member of the owning company in one of the download roles, and the
// document's own companyId must match the caller's company - a policyId from
// another company is refused even if it is guessed.
exports.requestPolicyDownloadUrl = onCall(async (request) => {
  const firestore = admin.firestore()
  const { companyId, role, uid } = await callerCompanyAndRole(firestore, request, 'policy_download_url')
  if (!DOWNLOAD_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'policy_download_url',
      outcome: 'denied:permission-denied',
      detail: 'role_not_download_role',
    })
    throw new HttpsError('permission-denied', 'You do not have permission to open policy documents')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'policy_download_url', outcome: 'granted' })

  const { policyId } = request.data || {}
  if (typeof policyId !== 'string' || !policyId) {
    throw new HttpsError('invalid-argument', 'policyId is required')
  }

  const snapshot = await firestore.collection(POLICIES_COLLECTION).doc(policyId).get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such policy document')
  }
  const data = snapshot.data()
  if (data.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'That policy document belongs to another company')
  }
  if (!data.storagePath) {
    throw new HttpsError('not-found', 'That policy document has no stored file')
  }
  // Defence in depth: firestore.rules lets a Company Admin create a
  // companyPolicies doc directly, so the storagePath on it is not fully trusted
  // here even though the upload callable is the only intended writer. Refuse to
  // sign a URL for anything outside this company's own policy prefix - a doc
  // crafted to point storagePath at case-evidence/** (or another company's
  // policies) must never be turned into a signed read URL.
  if (data.storagePath !== `${POLICY_PREFIX}/${companyId}/${policyId}/${data.fileName}`) {
    throw new HttpsError('permission-denied', 'That policy file path is not valid')
  }

  const { downloadUrl, expiresAt } = await createDownloadUrl(data.storagePath, data.fileName)
  return { downloadUrl, expiresAt, fileName: data.fileName ?? null, title: data.title ?? null }
})

exports.POLICIES_COLLECTION = POLICIES_COLLECTION
