const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')
const { hashToken, EXTERNAL_SHARES_COLLECTION } = require('./createShare')
const { resolveResponse } = require('../reports/questionCatalog')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const EXTERNAL_ACCESS_LOG_COLLECTION = 'externalAccessLog'

const MIN_ACCEPTED_NAME_LENGTH = 2

// This module is the entire boundary between an unauthenticated browser and
// a case record. It is deliberately not built on top of anything else that
// authorizes access to a case - not verifyReporterAccess (caseThread.js),
// not loadCaseForHandler (staffAuth.js), not compileReport (generateReport.js)
// - because none of those authorization models are the right one here, and
// reusing one would risk an external token someday satisfying a
// reporter-authenticated or staff-authenticated endpoint by accident. A
// share token proves exactly one thing: whoever holds it was handed this
// specific link for this specific case. It proves nothing else, and nothing
// is trusted here beyond a fresh, from-scratch verification of that one fact.

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : value ?? null
}

function callerIp(request) {
  const forwarded = request?.rawRequest?.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim()
  }
  return request?.rawRequest?.ip ?? null
}

function callerUserAgent(request) {
  const ua = request?.rawRequest?.headers?.['user-agent']
  return typeof ua === 'string' ? ua.slice(0, 500) : null
}

// Every call this callable receives is logged, granted or denied, expired,
// revoked, or mid-acceptance - "who looked at this link, when, from where"
// is exactly the accountability an external share exists to preserve, and
// it has to be true of every attempt, not only the ones that succeeded.
async function logExternalAccess(firestore, { shareId, caseId, request, outcome, fileName }) {
  await firestore.collection(EXTERNAL_ACCESS_LOG_COLLECTION).add({
    shareId: shareId ?? null,
    caseId: caseId ?? null,
    outcome,
    // Only ever set by accessSharedEvidence.js - a getSharedCase entry has no
    // single file to attribute an outcome to, so this stays null there.
    fileName: fileName ?? null,
    accessedAt: admin.firestore.FieldValue.serverTimestamp(),
    ipAddress: callerIp(request),
    userAgent: callerUserAgent(request),
  })
}

function verifyToken(token, tokenHash, tokenSalt) {
  if (typeof token !== 'string' || !token || !tokenHash || !tokenSalt) return false
  let candidateHash
  try {
    candidateHash = hashToken(token, tokenSalt)
  } catch {
    return false
  }
  const expected = Buffer.from(tokenHash, 'hex')
  const candidate = Buffer.from(candidateHash, 'hex')
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)
}

// Evidence as a metadata manifest, always, for every attachment on the case
// - no fileName-to-signed-URL path exists anywhere in this file, and none
// should ever be added; opening a file goes through accessSharedEvidence.js,
// a wholly separate callable, and only for a fileName in the share's own
// frozen `sharedEvidence` allowlist. Built fresh from the messages
// subcollection rather than reusing generateReport.js's evidence array, for
// the same reason the rest of this payload is built fresh: a shared field of
// the same NAME as an internal one must never be assumed to carry the same
// meaning or the same trust level.
//
// Each row carries `shared` (whether this share's allowlist includes it) and,
// only when shared, the real storage fileName the frontend needs to call
// accessSharedEvidence with - a non-shared row has nothing to open, so there
// is no reason to hand back the internal storage name for it.
function buildEvidenceManifest(messageDocs, sharedEvidenceSet) {
  const evidence = []
  for (const doc of messageDocs) {
    const data = doc.data()
    const attachments = Array.isArray(data.attachments) ? data.attachments : []
    for (const attachment of attachments) {
      const storedFileName = typeof attachment?.fileName === 'string' ? attachment.fileName : null
      const shared = Boolean(storedFileName && sharedEvidenceSet.has(storedFileName))
      evidence.push({
        label: attachment?.label ?? storedFileName ?? 'Attachment',
        contentType: attachment?.contentType ?? null,
        sizeBytes: attachment?.sizeBytes ?? null,
        uploadedAt: toMillis(attachment?.uploadedAt),
        shared,
        fileName: shared ? storedFileName : null,
      })
    }
  }
  return evidence
}

// 'full' scope timeline. System-authored entries (retention notices, share-
// activity notices - anything with sender 'system') are dropped
// unconditionally: they are administrative facts about how THIS platform
// manages the case, not case content, and one of them could name another
// share's recipient organisation - a fact a different external party has no
// business seeing. Attachment bytes/labels stay metadata-only here too, via
// buildEvidenceManifest, never inlined as a link.
function buildFullTimeline(messageDocs) {
  const SENDER_LABELS = { reporter: 'Reporter', investigator: 'Case Handler', ai: 'AI assistant' }
  return messageDocs
    .map((doc) => doc.data())
    .filter((data) => data.sender === 'reporter' || data.sender === 'investigator' || data.sender === 'ai')
    .map((data) => ({
      sender: SENDER_LABELS[data.sender] ?? 'Unknown',
      type: data.type === 'manual_log' ? 'investigator_log' : 'message',
      text: data.text ?? '',
      timestamp: toMillis(data.timestamp),
    }))
}

// The hard field allowlist, built fresh in this file. Every key here is
// typed out explicitly - there is no `...caseData` anywhere in this module,
// and there is no parameter, scope value, or role that reaches
// reporterIdentity, contactEmail, or any decrypted identity field. That is
// not enforced by omission alone: those two field names do not appear
// anywhere below, at either scope, for any case tier.
function buildSharedPayload({ share, caseData, messageDocs, companyName, sharedByEmail }) {
  const payload = {
    caseId: share.caseId,
    companyName: companyName ?? null,
    recipientName: share.recipientName ?? null,
    recipientOrganisation: share.recipientOrganisation ?? null,
    purpose: share.purpose ?? null,
    scope: share.scope,
    sharedByEmail: sharedByEmail ?? null,
    createdAt: toMillis(share.createdAt),
    expiresAt: toMillis(share.expiresAt),
    summary: {
      category: caseData.category ?? null,
      status: caseData.status ?? null,
      priority: caseData.priority ?? null,
      severityScore: caseData.severityScore ?? null,
      evidenceScore: caseData.evidenceScore ?? null,
      createdAt: toMillis(caseData.createdAt),
      closedAt: toMillis(caseData.closedAt),
    },
    complianceLog: {
      complianceRuleApplied: caseData.complianceRuleApplied ?? null,
      acknowledgmentDueAt: toMillis(caseData.acknowledgmentDueAt),
      acknowledgmentSentAt: toMillis(caseData.acknowledgmentSentAt),
      feedbackDueAt: toMillis(caseData.feedbackDueAt),
      feedbackGivenAt: toMillis(caseData.feedbackGivenAt),
    },
    finalAction: {
      proposedAction: caseData.proposedAction ?? null,
      actionTaken: caseData.actionTaken ?? null,
      actionEffectiveDate: toMillis(caseData.actionEffectiveDate),
      actionNotes: caseData.actionNotes ?? null,
    },
    evidence: buildEvidenceManifest(messageDocs, new Set(Array.isArray(share.sharedEvidence) ? share.sharedEvidence : [])),
  }

  if (share.scope === 'full') {
    payload.questionnaire = Array.isArray(caseData.responses)
      ? caseData.responses.map((response) => resolveResponse(caseData.category, response))
      : []
    payload.timeline = buildFullTimeline(messageDocs)
  }

  return payload
}

// getSharedCase({ shareId, token, acceptedName }). Unauthenticated by
// design - a reporter-style Case ID + passcode is never accepted here and
// this file never calls verifyReporterAccess. First call for a not-yet-
// accepted share must include acceptedName (min 2 characters); anything
// shorter returns { requiresAcceptance: true } with no case data, so the
// frontend can render the undertaking form before anything about the case
// is ever sent to the browser.
exports.getSharedCase = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { shareId, token, acceptedName } = request.data || {}
  const firestore = admin.firestore()

  await enforceRateLimit(firestore, 'getSharedCase', request)

  if (typeof shareId !== 'string' || !shareId || typeof token !== 'string' || !token) {
    throw new HttpsError('invalid-argument', 'shareId and token are required')
  }

  const shareRef = firestore.collection(EXTERNAL_SHARES_COLLECTION).doc(shareId)
  const shareSnap = await shareRef.get()

  if (!shareSnap.exists) {
    await logExternalAccess(firestore, { shareId, caseId: null, request, outcome: 'denied:not_found' })
    throw new HttpsError('permission-denied', 'This link is invalid or has expired')
  }
  const share = shareSnap.data()

  if (!verifyToken(token, share.tokenHash, share.tokenSalt)) {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:bad_token' })
    // Identical message to "not found" - a wrong token must not distinguish
    // "this share exists but your token is wrong" from "no such share",
    // which would itself be an oracle.
    throw new HttpsError('permission-denied', 'This link is invalid or has expired')
  }

  if (share.status === 'revoked') {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:revoked' })
    throw new HttpsError('permission-denied', 'This share has been revoked')
  }

  const expiresAtMs = toMillis(share.expiresAt)
  if (share.status === 'expired' || (expiresAtMs !== null && Date.now() >= expiresAtMs)) {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:expired' })
    throw new HttpsError('permission-denied', 'This share has expired')
  }

  // Acceptance gate. Recorded once, permanently - accepting a second time
  // with a different typed name does not overwrite the first acceptance,
  // because the undertaking is a one-time act, not a display preference.
  if (!share.acceptedAt) {
    const cleanAcceptedName = typeof acceptedName === 'string' ? acceptedName.trim().slice(0, 200) : ''
    if (cleanAcceptedName.length < MIN_ACCEPTED_NAME_LENGTH) {
      await logExternalAccess(firestore, {
        shareId,
        caseId: share.caseId,
        request,
        outcome: 'pending_acceptance',
      })
      return { requiresAcceptance: true }
    }
    await shareRef.update({
      acceptedName: cleanAcceptedName,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    share.acceptedName = cleanAcceptedName
  }

  const caseSnap = await firestore.collection(CASES_COLLECTION).doc(share.caseId).get()
  if (!caseSnap.exists) {
    await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'denied:case_missing' })
    throw new HttpsError('not-found', 'The underlying case record no longer exists')
  }
  const caseData = caseSnap.data()

  const messagesSnap = await caseSnap.ref.collection(MESSAGES_SUBCOLLECTION).orderBy('timestamp', 'asc').get()

  const [companySnap, staffSnap] = await Promise.all([
    caseData.companyId ? firestore.collection(COMPANIES_COLLECTION).doc(caseData.companyId).get() : null,
    caseData.companyId
      ? firestore
          .collection(COMPANIES_COLLECTION)
          .doc(caseData.companyId)
          .collection(STAFF_SUBCOLLECTION)
          .doc(share.createdByUid)
          .get()
      : null,
  ])
  const companyName = companySnap?.exists ? companySnap.data().name ?? null : null
  const sharedByEmail = staffSnap?.exists ? staffSnap.data().email ?? null : null

  const payload = buildSharedPayload({ share, caseData, messageDocs: messagesSnap.docs, companyName, sharedByEmail })

  await shareRef.update({
    accessCount: admin.firestore.FieldValue.increment(1),
    lastAccessedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  await logExternalAccess(firestore, { shareId, caseId: share.caseId, request, outcome: 'granted' })

  return { requiresAcceptance: false, ...payload }
})

// Reused by accessSharedEvidence.js so both callables verify a share token
// with the exact same logic rather than two copies that could drift.
exports.verifyToken = verifyToken
exports.logExternalAccess = logExternalAccess
exports.EXTERNAL_ACCESS_LOG_COLLECTION = EXTERNAL_ACCESS_LOG_COLLECTION
