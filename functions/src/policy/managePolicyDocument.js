const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { resolveStaffEffectivePermissions, hasPermission } = require('../utils/permissionResolver')
const { deletePolicyObject } = require('./policyStorage')

if (!admin.apps.length) {
  admin.initializeApp()
}

const POLICIES_COLLECTION = 'companyPolicies'
const CHUNKS_SUBCOLLECTION = 'chunks'

// Loads a policy document and verifies the authenticated caller is a Company
// Admin of the company that owns it. Company is taken from the caller's own
// custom claim, then checked against the document - a policyId from another
// company is refused even if guessed. Returns the doc ref and data.
async function loadOwnedPolicy(firestore, request, policyId, action) {
  const uid = requireAuthUid(request)
  const companyId = request.auth?.token?.companyId
  if (!companyId) {
    throw new HttpsError('permission-denied', 'Your account is not linked to a company')
  }
  const role = await loadCallerRole(firestore, companyId, uid, action)
  // A policyManagement custom-role holder may manage policy documents the
  // same as a Company Admin - resolved fresh from the customRoles doc, never
  // a cached claim.
  const resolved = role === 'companyAdmin' ? null : await resolveStaffEffectivePermissions(firestore, companyId, uid)
  const authorized = role === 'companyAdmin' || hasPermission(resolved, 'policyManagement')
  if (!authorized) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may manage policy documents')
  }
  if (typeof policyId !== 'string' || !policyId) {
    throw new HttpsError('invalid-argument', 'policyId is required')
  }
  const ref = firestore.collection(POLICIES_COLLECTION).doc(policyId)
  const snapshot = await ref.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such policy document')
  }
  if (snapshot.data().companyId !== companyId) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      detail: 'wrong_company_policy',
    })
    throw new HttpsError('permission-denied', 'That policy document belongs to another company')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action, outcome: 'granted' })
  return { ref, data: snapshot.data() }
}

// Archiving is reversible and non-destructive: the document and its chunks are
// retained (a closed case's report must still resolve the clauses in effect
// when it was created), but an archived document is excluded from
// getPolicyContext, so it stops grounding new cases. Only an 'active' document
// can be archived.
exports.archivePolicyDocument = onCall(async (request) => {
  const firestore = admin.firestore()
  const { policyId } = request.data || {}
  const { ref, data } = await loadOwnedPolicy(firestore, request, policyId, 'policy_archive')
  if (data.status !== 'active') {
    throw new HttpsError('failed-precondition', 'Only an active policy document can be archived')
  }
  await ref.update({
    status: 'archived',
    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { status: 'archived' }
})

// Restores an archived document to active so it grounds new cases again.
exports.restorePolicyDocument = onCall(async (request) => {
  const firestore = admin.firestore()
  const { policyId } = request.data || {}
  const { ref, data } = await loadOwnedPolicy(firestore, request, policyId, 'policy_restore')
  if (data.status !== 'archived') {
    throw new HttpsError('failed-precondition', 'Only an archived policy document can be restored')
  }
  await ref.update({
    status: 'active',
    archivedAt: admin.firestore.FieldValue.delete(),
  })
  return { status: 'active' }
})

// Hard delete: removes the Storage object, every chunk in the subcollection,
// and the parent document. This is the one destructive action, offered because
// an admin who uploaded the wrong file entirely needs a way to remove it -
// versioning covers re-uploads, deletion covers mistakes. A case whose report
// cited a now-deleted document degrades to showing the citation metadata it
// recorded at the time (title, version, heading path) without a live link,
// rather than breaking.
exports.deletePolicyDocument = onCall(async (request) => {
  const firestore = admin.firestore()
  const { policyId } = request.data || {}
  const { ref, data } = await loadOwnedPolicy(firestore, request, policyId, 'policy_delete')

  // Storage object first: if this fails we have not yet orphaned Firestore.
  await deletePolicyObject(data.storagePath)

  // Delete chunks in batches, then the parent.
  const chunksRef = ref.collection(CHUNKS_SUBCOLLECTION)
  while (true) {
    const batchSnapshot = await chunksRef.limit(400).get()
    if (batchSnapshot.empty) break
    const batch = firestore.batch()
    batchSnapshot.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
    if (batchSnapshot.size < 400) break
  }

  await ref.delete()
  return { deleted: true }
})
