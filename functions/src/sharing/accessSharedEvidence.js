const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')
const { EXTERNAL_SHARES_COLLECTION } = require('./createShare')
const { verifyToken, logExternalAccess } = require('./accessShare')
const { createDownloadUrl, logEvidenceAccess } = require('../utils/evidenceStorage')

if (!admin.apps.length) {
  admin.initializeApp()
}

// The only way an external share can open a file's bytes, not just read its
// metadata. Everything accessShare.js's module comment says about this
// boundary applies here too: this is not built on any staff- or
// reporter-authorization path, and a share token proves exactly one thing -
// whoever holds it was handed this specific link for this specific case.
//
// It is deliberately narrow in what it can do beyond that. The caseId is
// never taken from the client - it is read off the share document, so a
// caller cannot point a valid token at a different case's file. And the
// fileName must be in `sharedEvidence`, the allowlist createShare.js froze at
// creation time - this callable never enumerates or re-derives "what's
// attached to this case now"; it only ever checks one requested name against
// a list that was fixed before this call existed.
function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : value ?? null
}

// Every outcome from here on is logged twice: once to evidenceAccessLog (the
// same collection and shape every other evidence read/write uses, actor
// `external:${shareId}` since there is no staff uid or reporter passcode
// holder to name), and once to the share's own externalAccessLog via
// logExternalAccess - matching exactly how getSharedCase logs every attempt
// against a share, success or failure.
async function logBoth(firestore, { shareId, caseId, companyId, request, fileName, outcome }) {
  await logEvidenceAccess(firestore, {
    caseId: caseId ?? null,
    companyId: companyId ?? null,
    actor: `external:${shareId}`,
    action: 'shared_evidence_download_url_issued',
    fileName: fileName ?? null,
    outcome,
  })
  await logExternalAccess(firestore, { shareId, caseId: caseId ?? null, request, outcome, fileName })
}

exports.accessSharedEvidence = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { shareId, token, fileName } = request.data || {}
  const firestore = admin.firestore()

  await enforceRateLimit(firestore, 'accessSharedEvidence', request)

  if (
    typeof shareId !== 'string' ||
    !shareId ||
    typeof token !== 'string' ||
    !token ||
    typeof fileName !== 'string' ||
    !fileName
  ) {
    throw new HttpsError('invalid-argument', 'shareId, token, and fileName are required')
  }

  const shareRef = firestore.collection(EXTERNAL_SHARES_COLLECTION).doc(shareId)
  const shareSnap = await shareRef.get()

  if (!shareSnap.exists) {
    await logBoth(firestore, { shareId, caseId: null, request, fileName, outcome: 'denied:not_found' })
    throw new HttpsError('permission-denied', 'This link is invalid or has expired')
  }
  const share = shareSnap.data()

  // Same verifyToken logic accessShare.js's getSharedCase uses - a
  // timing-safe comparison against tokenHash/tokenSalt, imported rather than
  // reimplemented so the two callables can never drift on what "a valid
  // token" means.
  if (!verifyToken(token, share.tokenHash, share.tokenSalt)) {
    await logBoth(firestore, { shareId, caseId: share.caseId, companyId: share.companyId, request, fileName, outcome: 'denied:bad_token' })
    // Identical message to "not found", for the same reason getSharedCase
    // gives one: a wrong token must not be distinguishable from no such share.
    throw new HttpsError('permission-denied', 'This link is invalid or has expired')
  }

  if (share.status === 'revoked') {
    await logBoth(firestore, { shareId, caseId: share.caseId, companyId: share.companyId, request, fileName, outcome: 'denied:revoked' })
    throw new HttpsError('permission-denied', 'This share has been revoked')
  }

  const expiresAtMs = toMillis(share.expiresAt)
  if (share.status === 'expired' || (expiresAtMs !== null && Date.now() >= expiresAtMs)) {
    await logBoth(firestore, { shareId, caseId: share.caseId, companyId: share.companyId, request, fileName, outcome: 'denied:expired' })
    throw new HttpsError('permission-denied', 'This share has expired')
  }

  const allowlist = Array.isArray(share.sharedEvidence) ? share.sharedEvidence : []
  if (!allowlist.includes(fileName)) {
    await logBoth(firestore, { shareId, caseId: share.caseId, companyId: share.companyId, request, fileName, outcome: 'denied:not_shared' })
    throw new HttpsError('permission-denied', 'This file was not included in the shared evidence for this link')
  }

  // The same short-lived, non-persisted signed URL every other evidence read
  // in this app mints - createDownloadUrl enforces its own 15-minute ceiling
  // regardless of what is asked for, and nothing here stores the result.
  const { downloadUrl, expiresAt } = await createDownloadUrl(share.caseId, fileName)

  await logBoth(firestore, { shareId, caseId: share.caseId, companyId: share.companyId, request, fileName, outcome: 'granted' })

  return { downloadUrl, expiresAt }
})
