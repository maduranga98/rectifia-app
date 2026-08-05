const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { resolveRetentionPolicy } = require('./retentionPolicy')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const CASES_COLLECTION = 'cases'
const CASE_METADATA_COLLECTION = 'caseMetadata'
const MESSAGES_SUBCOLLECTION = 'messages'
const PATTERN_SIGNALS_COLLECTION = 'patternSignals'
const PUSH_SUBSCRIPTIONS_COLLECTION = 'pushSubscriptions'
const PULSE_RESPONSES_COLLECTION = 'pulseResponses'
const PULSE_INVITES_COLLECTION = 'pulseInvites'
const NOTIFICATIONS_COLLECTION = 'notifications'
const RATE_LIMITS_COLLECTION = 'rateLimits'
const DELETION_LOG_COLLECTION = 'deletionLog'
const EVIDENCE_PREFIX = 'case-evidence'

const DAY_MS = 24 * 60 * 60 * 1000
const FIRESTORE_BATCH_LIMIT = 400

// Hard per-run ceiling on how many cases (Tier 1 identity purges plus Tier 2
// case deletions, combined) one invocation will touch, across every company.
// A sweep that times out halfway through deleting a case's subcollections is
// how you get orphaned evidence in Storage with no Firestore doc pointing at
// it, so this bounds the blast radius of any single run rather than trying to
// process an unbounded backlog in one shot - a company with more than this
// many eligible cases simply finishes over several days, oldest first.
const MAX_CASES_PER_RUN = 200

// How many candidate rows to pull per company per tier before filtering
// legal holds out in memory. Wider than MAX_CASES_PER_RUN so a company whose
// oldest eligible cases are mostly on hold doesn't starve everyone behind
// them - see filterCandidates below.
const CANDIDATE_BATCH_SIZE = 250

// Lower-stakes housekeeping (no Storage, no subcollections, no accountability
// record) gets its own generous batch size independent of the case budget.
const HOUSEKEEPING_BATCH_SIZE = 400
const NOTIFICATION_RETENTION_DAYS = 90

function daysAgo(days) {
  return admin.firestore.Timestamp.fromMillis(Date.now() - days * DAY_MS)
}

function onLegalHold(data) {
  return data?.legalHold?.active === true
}

// Deletes every batch of an array of doc refs in chunks under Firestore's
// 500-write batch ceiling, mirroring the chunked-delete loop in
// functions/src/policy/managePolicyDocument.js.
async function deleteRefs(firestore, refs) {
  for (let i = 0; i < refs.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = refs.slice(i, i + FIRESTORE_BATCH_LIMIT)
    const batch = firestore.batch()
    chunk.forEach((ref) => batch.delete(ref))
    // eslint-disable-next-line no-await-in-loop
    await batch.commit()
  }
}

async function deleteSubcollection(firestore, collectionRef) {
  let total = 0
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const snapshot = await collectionRef.limit(FIRESTORE_BATCH_LIMIT).get()
    if (snapshot.empty) break
    // eslint-disable-next-line no-await-in-loop
    await deleteRefs(firestore, snapshot.docs.map((d) => d.ref))
    total += snapshot.size
    if (snapshot.size < FIRESTORE_BATCH_LIMIT) break
  }
  return total
}

// Deletes every object under case-evidence/{caseId}/ and then re-lists the
// prefix to confirm it is genuinely empty before the caller is allowed to
// proceed to the Firestore parent. Storage deletion is not "best effort" here:
// a case whose evidence cannot be verified empty is left entirely alone -
// Firestore doc included - rather than risk a document deleted out from under
// evidence that is still sitting in the bucket with nothing left to find it.
async function deleteCaseEvidence(caseId) {
  const bucket = admin.storage().bucket()
  const prefix = `${EVIDENCE_PREFIX}/${caseId}/`
  const [files] = await bucket.getFiles({ prefix })
  await Promise.all(files.map((file) => file.delete({ ignoreNotFound: true })))

  const [remaining] = await bucket.getFiles({ prefix, maxResults: 1 })
  if (remaining.length > 0) {
    throw new Error(`case-evidence/${caseId}/ still has objects after delete`)
  }
  return files.length
}

async function writeDeletionLog(firestore, entry) {
  await firestore.collection(DELETION_LOG_COLLECTION).add({
    actorUid: 'system',
    ...entry,
    occurredAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Cases sharing a department + role tier signal (module 16) are recomputed
// from scratch every day by functions/src/patterns/detectPatterns.js - a
// signal document is a rebuildable cache over caseMetadata, never the source
// of truth. That is what makes it safe to delete rows referencing a case that
// is going away: the next daily run rebuilds whatever signals still legitimately
// exist (minus this case, whose caseMetadata mirror is gone by then), so this
// never destroys another case's data, it just clears a stale reference early
// instead of waiting for tomorrow's rebuild to notice the case is gone.
async function deletePatternSignalReferences(firestore, caseId) {
  const snapshot = await firestore
    .collection(PATTERN_SIGNALS_COLLECTION)
    .where('caseIds', 'array-contains', caseId)
    .get()
  if (snapshot.empty) return
  await deleteRefs(firestore, snapshot.docs.map((d) => d.ref))
}

// Tier 1: purges reporterIdentity, contactEmail and the pushSubscriptions
// doc for cases closed longer ago than identityRetentionDays. Never touches
// case content - the case, its messages, and its evidence are untouched and
// keep aging toward their own, longer, Tier 2 clock.
//
// The identityPurgedAt == null filter only matches documents that carry the
// field - submitCase.js and createCaseOnBehalf.js write it explicitly as
// null at creation so every case is queryable here from the moment it
// exists. A case document written before this module shipped, with no
// identityPurgedAt field at all, will not match this query and needs a
// one-time backfill (identityPurgedAt: null) before it becomes eligible.
async function sweepIdentity(firestore, companyId, policy, budget) {
  if (budget <= 0) return budget
  const cutoff = daysAgo(policy.identityRetentionDays)

  const snapshot = await firestore
    .collection(CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('status', '==', 'closed')
    .where('identityPurgedAt', '==', null)
    .where('closedAt', '<=', cutoff)
    .orderBy('closedAt', 'asc')
    .limit(CANDIDATE_BATCH_SIZE)
    .get()

  for (const doc of snapshot.docs) {
    if (budget <= 0) break
    const data = doc.data()
    if (onLegalHold(data)) continue // litigation freezes identity data too

    try {
      // eslint-disable-next-line no-await-in-loop
      await doc.ref.update({
        reporterIdentity: admin.firestore.FieldValue.delete(),
        contactEmail: admin.firestore.FieldValue.delete(),
        identityPurgedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      // eslint-disable-next-line no-await-in-loop
      await firestore
        .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
        .doc(doc.id)
        .delete()
        .catch(() => {})
      // Content-free note on the case's own timeline, so the record a
      // handler reads later is truthful about what happened to it - not a
      // silent gap where identity data used to be.
      // eslint-disable-next-line no-await-in-loop
      await doc.ref.collection(MESSAGES_SUBCOLLECTION).add({
        sender: 'system',
        type: 'manual_log',
        text: 'Reporter identity data was purged under this company’s data retention policy.',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      })
      // eslint-disable-next-line no-await-in-loop
      await writeDeletionLog(firestore, {
        companyId,
        caseId: doc.id,
        action: 'tier1_purge',
        reason: `Identity retention window (${policy.identityRetentionDays} days since closure) elapsed`,
        itemCounts: { messages: 0, evidenceObjects: 0 },
      })
      budget -= 1
    } catch (err) {
      logger.error('applyRetention: tier1 purge failed', { caseId: doc.id, companyId, error: err.message })
    }
  }

  return budget
}

// The Tier 2 hard-delete body, shared by the scheduled sweep below and the
// reporter-initiated erasure path (functions/src/retention/deletionRequest.js's
// approveDeletionRequest), so the two ways a case's content can be destroyed -
// its retention window elapsing, or a human approving a deletion request -
// can never drift into deleting different things. Storage objects are removed
// and verified empty FIRST, then the messages subcollection, the caseMetadata
// mirror and any patternSignals references, and only then the case document
// itself - so a crash mid-delete leaves, at worst, a case doc with no
// evidence pointing at it (recoverable: nothing was orphaned) rather than
// evidence sitting in the bucket with no Firestore doc left to find it.
// Returns { messages, evidenceObjects } for the caller's deletionLog entry.
async function hardDeleteCaseContent(firestore, caseRef) {
  const caseId = caseRef.id
  const evidenceObjects = await deleteCaseEvidence(caseId)
  const messages = await deleteSubcollection(firestore, caseRef.collection(MESSAGES_SUBCOLLECTION))
  await firestore.collection(CASE_METADATA_COLLECTION).doc(caseId).delete().catch(() => {})
  await deletePatternSignalReferences(firestore, caseId)
  await firestore.collection(PUSH_SUBSCRIPTIONS_COLLECTION).doc(caseId).delete().catch(() => {})
  // The Firestore parent, last - see the comment above.
  await caseRef.delete()
  return { messages, evidenceObjects }
}

// Tier 2: hard-deletes cases closed longer ago than caseRetentionDays and not
// on legal hold, via hardDeleteCaseContent above.
async function sweepCaseContent(firestore, companyId, policy, budget) {
  if (budget <= 0) return budget
  const cutoff = daysAgo(policy.caseRetentionDays)

  const snapshot = await firestore
    .collection(CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('status', '==', 'closed')
    .where('closedAt', '<=', cutoff)
    .orderBy('closedAt', 'asc')
    .limit(CANDIDATE_BATCH_SIZE)
    .get()

  for (const doc of snapshot.docs) {
    if (budget <= 0) break
    const data = doc.data()
    if (onLegalHold(data)) continue

    const caseId = doc.id
    try {
      // eslint-disable-next-line no-await-in-loop
      const { messages, evidenceObjects } = await hardDeleteCaseContent(firestore, doc.ref)
      // eslint-disable-next-line no-await-in-loop
      await writeDeletionLog(firestore, {
        companyId,
        caseId,
        action: 'tier2_delete',
        reason: `Case retention window (${policy.caseRetentionDays} days since closure) elapsed`,
        itemCounts: { messages, evidenceObjects },
      })
      budget -= 1
    } catch (err) {
      // Evidence that failed to verify empty (or any other failure) leaves
      // the case untouched - it is picked up again on a future run rather
      // than partially deleted now.
      logger.error('applyRetention: tier2 delete failed, case left intact', {
        caseId,
        companyId,
        error: err.message,
      })
    }
  }

  return budget
}

// pulseResponses individual answers age out on their own clock, independent
// of any case. pulseSummaries and pulseSummaryTotals are never touched here -
// they are already aggregate and k-anonymised (see analyzePulseResponse.js),
// which is precisely what lets them survive the deletion of the individual
// responses that fed them.
async function sweepPulseResponses(firestore, companyId, policy) {
  const cutoff = daysAgo(policy.pulseResponseRetentionDays)
  const snapshot = await firestore
    .collection(PULSE_RESPONSES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('submittedAt', '<=', cutoff)
    .orderBy('submittedAt', 'asc')
    .limit(HOUSEKEEPING_BATCH_SIZE)
    .get()
  if (snapshot.empty) return
  await deleteRefs(firestore, snapshot.docs.map((d) => d.ref))
}

// Housekeeping with no per-company scoping: expired single-use pulse invites,
// spent rate-limit counters (a Firestore TTL policy on rateLimits.expiresAt
// should already remove most of these - see functions/src/utils/rateLimit.js -
// this is a defensive sweep for the window before TTL catches up), and
// notifications older than 90 days. None of these are case content or
// identity-bearing, so they run once per invocation rather than per company.
async function sweepHousekeeping(firestore) {
  const now = admin.firestore.Timestamp.now()

  const expiredInvites = await firestore
    .collection(PULSE_INVITES_COLLECTION)
    .where('expiresAt', '<=', now)
    .limit(HOUSEKEEPING_BATCH_SIZE)
    .get()
  if (!expiredInvites.empty) {
    await deleteRefs(firestore, expiredInvites.docs.map((d) => d.ref))
  }

  const spentRateLimits = await firestore
    .collection(RATE_LIMITS_COLLECTION)
    .where('expiresAt', '<=', now)
    .limit(HOUSEKEEPING_BATCH_SIZE)
    .get()
  if (!spentRateLimits.empty) {
    await deleteRefs(firestore, spentRateLimits.docs.map((d) => d.ref))
  }

  const staleNotifications = await firestore
    .collection(NOTIFICATIONS_COLLECTION)
    .where('createdAt', '<=', daysAgo(NOTIFICATION_RETENTION_DAYS))
    .limit(HOUSEKEEPING_BATCH_SIZE)
    .get()
  if (!staleNotifications.empty) {
    await deleteRefs(firestore, staleNotifications.docs.map((d) => d.ref))
  }
}

// Runs daily, off-peak. Walks every company, resolves its effective policy
// (defaults with per-company overrides, clamped to floor/ceiling - see
// retentionPolicy.js) and sweeps Tier 1 identity data, then Tier 2 case
// content, against a shared per-run budget so no single company's backlog can
// starve every other company's sweep. referenceCases is never touched by any
// sweep here, deliberately - see the comment on REFERENCE_CASE_RETENTION in
// retentionPolicy.js for why that is a permanent exclusion, not an oversight.
exports.applyRetention = onSchedule('every day 03:00', async () => {
  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()

  let budget = MAX_CASES_PER_RUN
  for (const companyDoc of companiesSnapshot.docs) {
    if (budget <= 0) break
    const policy = resolveRetentionPolicy(companyDoc.data())
    try {
      // eslint-disable-next-line no-await-in-loop
      budget = await sweepIdentity(firestore, companyDoc.id, policy, budget)
      // eslint-disable-next-line no-await-in-loop
      budget = await sweepCaseContent(firestore, companyDoc.id, policy, budget)
      // eslint-disable-next-line no-await-in-loop
      await sweepPulseResponses(firestore, companyDoc.id, policy)
    } catch (err) {
      logger.error('applyRetention: company sweep failed', { companyId: companyDoc.id, error: err.message })
    }
  }

  try {
    await sweepHousekeeping(firestore)
  } catch (err) {
    logger.error('applyRetention: housekeeping sweep failed', { error: err.message })
  }
})

// Exported for functions/src/retention/deletionRequest.js's
// approveDeletionRequest, the reporter-initiated erasure path - so an
// approved deletion request destroys exactly what a Tier 2 sweep would have
// destroyed on its own clock, just now instead of later, rather than a
// second implementation that could drift from this one.
exports.hardDeleteCaseContent = hardDeleteCaseContent
exports.writeDeletionLog = writeDeletionLog
exports.onLegalHold = onLegalHold
exports.CASES_COLLECTION = CASES_COLLECTION
