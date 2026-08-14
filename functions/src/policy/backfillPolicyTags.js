const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole } = require('../utils/staffAuth')
const { tagChunk } = require('./tagPolicyChunks')

if (!admin.apps.length) {
  admin.initializeApp()
}

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')

const POLICIES_COLLECTION = 'companyPolicies'
const CHUNKS_SUBCOLLECTION = 'chunks'

// How many chunks are in flight at once. This is a manual, occasional
// operation on a handful of documents, not a hot path - there is no reason
// to fire dozens of Claude calls at once for it.
const CONCURRENCY = 8

async function loadOwnedPolicy(firestore, request, policyId) {
  const uid = requireAuthUid(request)
  const companyId = request.auth?.token?.companyId
  if (!companyId) {
    throw new HttpsError('permission-denied', 'Your account is not linked to a company')
  }
  const role = await loadCallerRole(firestore, companyId, uid, 'policy_backfill_tags')
  if (role !== 'companyAdmin') {
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
    throw new HttpsError('permission-denied', 'That policy document belongs to another company')
  }
  return ref
}

async function retagChunk(firestore, policyRef, chunkSnapshot, apiKey) {
  const chunk = chunkSnapshot.data()
  const text = typeof chunk.text === 'string' ? chunk.text : ''
  if (!text.trim()) return false

  const result = await tagChunk({ apiKey, text })

  await chunkSnapshot.ref.update({
    categories: result.categories,
    summary: result.summary,
  })

  if (result.categories.length === 0) return true

  await firestore.runTransaction(async (tx) => {
    const policySnapshot = await tx.get(policyRef)
    if (!policySnapshot.exists) return
    const existing = Array.isArray(policySnapshot.data().categoriesCovered)
      ? policySnapshot.data().categoriesCovered
      : []
    const merged = Array.from(new Set([...existing, ...result.categories]))
    if (merged.length !== existing.length) {
      tx.update(policyRef, { categoriesCovered: merged })
    }
  })

  return true
}

// One-off admin-triggered callable to retag chunks that were written while
// output_config.effort (invalid on Haiku) made every tagPolicyChunks call
// fail, leaving them stuck with their default categories: [] / summary: ''
// forever. Re-running this after the fix is safe: it only ever touches
// chunks whose categories array is still empty, so an already-tagged chunk
// (tagged before the bug, after this fix, or by a previous backfill run) is
// left untouched.
exports.backfillPolicyTags = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  const firestore = admin.firestore()
  const { policyId } = request.data || {}
  const policyRef = await loadOwnedPolicy(firestore, request, policyId)

  const chunksSnapshot = await policyRef
    .collection(CHUNKS_SUBCOLLECTION)
    .where('categories', '==', [])
    .get()

  const totalChunks = (await policyRef.collection(CHUNKS_SUBCOLLECTION).count().get()).data().count
  const untaggedDocs = chunksSnapshot.docs
  const alreadyTagged = totalChunks - untaggedDocs.length

  let retagged = 0
  let failed = 0
  const apiKey = anthropicApiKey.value()

  for (let i = 0; i < untaggedDocs.length; i += CONCURRENCY) {
    const batch = untaggedDocs.slice(i, i + CONCURRENCY)
    const outcomes = await Promise.allSettled(
      batch.map((chunkSnapshot) => retagChunk(firestore, policyRef, chunkSnapshot, apiKey))
    )
    for (let j = 0; j < outcomes.length; j++) {
      const outcome = outcomes[j]
      if (outcome.status === 'fulfilled') {
        if (outcome.value) retagged++
      } else {
        failed++
        logger.error('backfillPolicyTags: retagging failed', {
          policyId,
          chunkId: batch[j].id,
          error: outcome.reason?.message,
        })
      }
    }
  }

  return { totalChunks, alreadyTagged, retagged, failed }
})
