import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

const POLICIES_COLLECTION = 'companyPolicies'

// The four case categories a policy chunk can be tagged with, mirrored from
// functions/src/policy/tagPolicyChunks.js so the coverage summary on
// PoliciesPage can show, per category, whether anything is uploaded to ground
// it. Kept in the frontend as a plain list because the page needs the labels.
export const POLICY_CATEGORIES = [
  { id: 'harassment', label: 'Harassment' },
  { id: 'toxicManagement', label: 'Toxic management' },
  { id: 'retaliation', label: 'Retaliation' },
  { id: 'burnout', label: 'Burnout' },
]

// Client-side type/size allowlist, matching the server allowlist in
// functions/src/policy/policyStorage.js. The server is the real gate; this is
// so the picker can reject an obviously-wrong file before spending an upload
// URL on it.
export const ALLOWED_POLICY_TYPES = new Map([
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['text/plain', '.txt'],
  ['text/markdown', '.md'],
])
export const MAX_POLICY_BYTES = 10 * 1024 * 1024

const requestPolicyUploadUrlCallable = httpsCallable(functions, 'requestPolicyUploadUrl')
const requestPolicyDownloadUrlCallable = httpsCallable(functions, 'requestPolicyDownloadUrl')
const archivePolicyDocumentCallable = httpsCallable(functions, 'archivePolicyDocument')
const restorePolicyDocumentCallable = httpsCallable(functions, 'restorePolicyDocument')
const deletePolicyDocumentCallable = httpsCallable(functions, 'deletePolicyDocument')

// The .md exception: a Markdown file is very often served by the browser as
// text/plain (empty file.type on some systems too). Accept it by extension so
// a legitimate .md upload isn't blocked, then let the server settle the
// canonical type.
export function resolveContentType(file) {
  if (file.type && ALLOWED_POLICY_TYPES.has(file.type)) return file.type
  const name = String(file.name || '').toLowerCase()
  if (name.endsWith('.md')) return 'text/markdown'
  if (name.endsWith('.txt')) return 'text/plain'
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  return file.type || ''
}

export function validatePolicyFile(file) {
  const contentType = resolveContentType(file)
  if (!ALLOWED_POLICY_TYPES.has(contentType)) {
    return 'That file type is not allowed. Upload a PDF, DOCX, TXT or Markdown file.'
  }
  if (!file.size || file.size <= 0) {
    return 'That file appears to be empty.'
  }
  if (file.size > MAX_POLICY_BYTES) {
    return `That file is too large. The maximum policy document size is ${Math.floor(
      MAX_POLICY_BYTES / (1024 * 1024)
    )}MB.`
  }
  return null
}

function serializePolicy(id, data) {
  return {
    id,
    companyId: data.companyId ?? null,
    title: data.title ?? '',
    fileName: data.fileName ?? '',
    mimeType: data.mimeType ?? null,
    sizeBytes: data.sizeBytes ?? null,
    status: data.status ?? 'processing',
    version: typeof data.version === 'number' ? data.version : null,
    chunkCount: typeof data.chunkCount === 'number' ? data.chunkCount : 0,
    categoriesCovered: Array.isArray(data.categoriesCovered) ? data.categoriesCovered : [],
    uploadedByUid: data.uploadedByUid ?? null,
    uploadedAt: data.uploadedAt ?? null,
    errorMessage: data.errorMessage ?? null,
  }
}

// Lists a company's policy documents, newest upload first. Reads
// companyPolicies directly - firestore.rules lets any staff of the company read
// the document metadata (never the chunk text through this path).
export async function listPolicies(companyId) {
  if (!companyId) return []
  const snapshot = await getDocs(
    query(
      collection(firestore, POLICIES_COLLECTION),
      where('companyId', '==', companyId),
      orderBy('uploadedAt', 'desc')
    )
  )
  return snapshot.docs.map((d) => serializePolicy(d.id, d.data()))
}

async function fetchPolicy(policyId) {
  const snapshot = await getDoc(doc(firestore, POLICIES_COLLECTION, policyId))
  if (!snapshot.exists()) return null
  return serializePolicy(snapshot.id, snapshot.data())
}

// Full upload orchestration: ask for a signed URL (which also creates the
// companyPolicies doc in 'processing'), PUT the bytes, then poll the doc until
// ingestion moves it out of 'processing' to 'active' or 'failed'. Returns the
// final document. onProgress(status) is called with 'requesting' | 'uploading'
// | 'processing' so the UI can show where it is.
export async function uploadPolicy({ companyId, title, file }, onProgress) {
  const validationError = validatePolicyFile(file)
  if (validationError) throw new Error(validationError)

  const contentType = resolveContentType(file)

  onProgress?.('requesting')
  const { data } = await requestPolicyUploadUrlCallable({
    companyId,
    title,
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
  })

  onProgress?.('uploading')
  const response = await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': data.contentType },
    body: file,
  })
  if (!response.ok) {
    throw new Error('That file could not be uploaded. Please try again.')
  }

  onProgress?.('processing')
  // Poll for ingestion + tagging to finish. The Storage trigger extracts and
  // chunks; a large document with many chunks can take a little while, so this
  // is generous but bounded - if it never leaves 'processing' the caller still
  // gets the doc back and the table shows the processing state.
  const POLL_INTERVAL_MS = 1500
  const MAX_POLLS = 60
  let policy = null
  for (let i = 0; i < MAX_POLLS; i++) {
    // eslint-disable-next-line no-await-in-loop
    policy = await fetchPolicy(data.policyId)
    if (policy && policy.status !== 'processing') break
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return policy ?? { id: data.policyId, status: 'processing' }
}

export async function archivePolicy(policyId) {
  await archivePolicyDocumentCallable({ policyId })
}

export async function restorePolicy(policyId) {
  await restorePolicyDocumentCallable({ policyId })
}

export async function deletePolicy(policyId) {
  await deletePolicyDocumentCallable({ policyId })
}

// Fetches a fresh, short-lived signed URL to open a policy document at the
// moment it is clicked. Nothing caches it - the URL is a bearer credential with
// a 15-minute life. Used by PolicyReferences.jsx and PoliciesPage.jsx.
export async function getPolicyDownloadUrl(policyId) {
  const { data } = await requestPolicyDownloadUrlCallable({ policyId })
  return data.downloadUrl
}

// Reads the policy clauses tagged with a category for a company, as they exist
// now - used by the investigation view to show what grounding a category can
// draw on. This is a live view of the active policy; a case's own recorded
// provenance (case.policyCitations) is what PolicyReferences shows as "used on
// this case", which may differ if the policy changed after the case was scored.
export async function listPolicyCitations(companyId, category) {
  if (!companyId || !category) return []
  const policiesSnapshot = await getDocs(
    query(
      collection(firestore, POLICIES_COLLECTION),
      where('companyId', '==', companyId),
      where('status', '==', 'active')
    )
  )
  const results = []
  for (const policyDoc of policiesSnapshot.docs) {
    const policy = policyDoc.data()
    // eslint-disable-next-line no-await-in-loop
    const chunksSnapshot = await getDocs(
      query(
        collection(firestore, POLICIES_COLLECTION, policyDoc.id, 'chunks'),
        where('categories', 'array-contains', category)
      )
    )
    chunksSnapshot.docs.forEach((chunkDoc) => {
      const chunk = chunkDoc.data()
      results.push({
        policyId: policyDoc.id,
        chunkId: chunkDoc.id,
        title: policy.title ?? null,
        version: typeof policy.version === 'number' ? policy.version : null,
        headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath : [],
        order: typeof chunk.order === 'number' ? chunk.order : null,
        summary: chunk.summary ?? '',
      })
    })
  }
  return results
}
