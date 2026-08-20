const { HttpsError } = require('firebase-functions/v2/https')
const { defineInt, defineString, defineBoolean } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const crypto = require('crypto')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Abuse and cost controls for the callables that have no Firebase Auth at all.
//
// A reporter has no account by design (Case ID + passcode IS the credential),
// so there is no uid to attribute a request to and no per-account quota to
// hang a limit on. Two independent controls stand in for it:
//
//   1. App Check (enforceAppCheck below) - proves the call came from our own
//      web app rather than a script hitting the callable endpoint directly.
//   2. This fixed-window counter - bounds what a single caller can do even
//      when they are driving a real browser.
//
// Neither is a substitute for the other: App Check stops the cheap bulk
// attacks, the counter stops the patient ones. submitCase and
// postReporterMessage each trigger a paid Claude call, so their limits are
// tight; a slug lookup costs one indexed read, so its limit is loose.
const RATE_LIMITS_COLLECTION = 'rateLimits'

// ---------------------------------------------------------------------------
// Limits. All deploy-time config (firebase-functions/params) rather than
// constants, so a limit can be retuned from the launch console when real
// traffic shows what normal looks like, without a code deploy.
// ---------------------------------------------------------------------------
const HOUR_MS = 60 * 60 * 1000

// Each entry pairs the deploy-time param with the same number as a literal
// fallback. The pairing is not redundancy for its own sake: a param that has
// not been materialized into the runtime environment resolves to 0, not to its
// declared default, and this limiter has to do something sensible with that.
//
// Failing closed on a *config* read would be the wrong call - it turns a
// missing environment variable into a total outage of every reporter-facing
// endpoint, which is a worse failure than the one the limiter exists to
// prevent. Failing open would silently remove the control. Falling back to the
// intended number does neither: the limit that was designed is the limit that
// applies, whether or not the param resolved.
function limit(name, envVar, fallback) {
  return { name, param: defineInt(envVar, { default: fallback }), fallback }
}

const limits = {
  // One reporter filing three genuine reports in an hour is already unusual.
  // Each one costs a Claude scoring call plus a follow-up call.
  submitCase: limit('submitCase', 'RATE_LIMIT_SUBMIT_CASE', 3),
  // Brute-force defence. The RC-YYYY-NNNN keyspace is 9000 ids per year, so
  // the Case ID is not a secret - the passcode is - but 10 tries an hour makes
  // even confirming which ids exist impractical.
  validateCaseAccess: limit('validateCaseAccess', 'RATE_LIMIT_VALIDATE_CASE_ACCESS', 10),
  // Per case, not per caller: see the scope argument at the call site.
  postReporterMessage: limit('postReporterMessage', 'RATE_LIMIT_POST_REPORTER_MESSAGE', 20),
  // One indexed read. Loose enough that a shared office NAT never trips it.
  resolveCompanySlug: limit('resolveCompanySlug', 'RATE_LIMIT_RESOLVE_COMPANY_SLUG', 60),
  // Polled every 8 seconds by an open thread view (see CaseThread.jsx), so
  // this one has to clear 450/hour of entirely legitimate traffic per case.
  getCaseThread: limit('getCaseThread', 'RATE_LIMIT_GET_CASE_THREAD', 600),
  registerPushSubscription: limit('registerPushSubscription', 'RATE_LIMIT_REGISTER_PUSH', 10),
  unregisterPushSubscription: limit('unregisterPushSubscription', 'RATE_LIMIT_UNREGISTER_PUSH', 10),
  validatePulseInvite: limit('validatePulseInvite', 'RATE_LIMIT_VALIDATE_PULSE_INVITE', 20),
  submitPulseResponse: limit('submitPulseResponse', 'RATE_LIMIT_SUBMIT_PULSE_RESPONSE', 5),
  // A whole-company pulse-check send, scoped per company (see the scope
  // argument at the call site in sendPulseChecksNow.js). One an hour is plenty:
  // the point of the manual trigger is to send a batch on demand, not to fire
  // repeatedly, and each press supersedes every outstanding link anyway.
  sendPulseChecksNow: limit('sendPulseChecksNow', 'RATE_LIMIT_SEND_PULSE_CHECKS_NOW', 1),
  requestEvidenceUploadUrl: limit('requestEvidenceUploadUrl', 'RATE_LIMIT_EVIDENCE_UPLOAD', 20),
  requestEvidenceDownloadUrl: limit('requestEvidenceDownloadUrl', 'RATE_LIMIT_EVIDENCE_DOWNLOAD', 60),
  // A Company Admin uploading policy documents. Each upload triggers text
  // extraction, chunking, and a Haiku tagging call per chunk, so it is bounded
  // like the other upload-url callables rather than left open.
  requestPolicyUploadUrl: limit('requestPolicyUploadUrl', 'RATE_LIMIT_POLICY_UPLOAD', 20),
  // A reporter answering a post-closure follow-up prompt (and possibly filing
  // one retaliation case from it). Low volume by nature - a handful of prompts
  // ever exist per case - but filing spends a Claude scoring call on the new
  // case, so it is bounded like the other write paths rather than left open.
  submitFollowUpResponse: limit('submitFollowUpResponse', 'RATE_LIMIT_SUBMIT_FOLLOW_UP', 10),
  // The three reporter-initiated identity transitions
  // (functions/src/intake/identityTransition.js), all scoped per case like
  // postReporterMessage. Each is a decision a reporter makes at most a couple
  // of times in the life of a case, so the numbers are small on purpose: a
  // caller repeatedly toggling a contact address is not a reporter changing
  // their mind, and the identity upgrade is irreversible after the first
  // success, so anything past that is a retry after an error at worst.
  upgradeToConfidential: limit('upgradeToConfidential', 'RATE_LIMIT_UPGRADE_TO_CONFIDENTIAL', 5),
  addContactEmail: limit('addContactEmail', 'RATE_LIMIT_ADD_CONTACT_EMAIL', 5),
  removeContactEmail: limit('removeContactEmail', 'RATE_LIMIT_REMOVE_CONTACT_EMAIL', 5),
  // The reporter-initiated erasure request (module 23,
  // functions/src/retention/deletionRequest.js), scoped per case like the
  // identity transitions above. It only ever flips a case into
  // deletionRequested.pending once - a second call while one is already
  // pending is rejected on that state, not on this limit - so this exists
  // purely to bound retries after a network error, not repeated use.
  requestCaseDeletion: limit('requestCaseDeletion', 'RATE_LIMIT_REQUEST_CASE_DELETION', 5),
  // Module 27's external share view (functions/src/sharing/accessShare.js).
  // The token is 32 random bytes - not brute-forceable in any practical
  // sense - so this is defence in depth rather than the primary control, the
  // same posture validateCaseAccess has toward a guessable Case ID. Loose
  // enough to cover a normal viewing session (initial load, an accidental
  // refresh) without tripping on legitimate use.
  getSharedCase: limit('getSharedCase', 'RATE_LIMIT_GET_SHARED_CASE', 20),
  // The evidence-opening counterpart of getSharedCase
  // (functions/src/sharing/accessSharedEvidence.js), same token, same
  // defence-in-depth posture. Scoped a little tighter than getSharedCase
  // itself since a normal viewing session opens a handful of files, not a
  // handful of page loads.
  accessSharedEvidence: limit('accessSharedEvidence', 'RATE_LIMIT_ACCESS_SHARED_EVIDENCE', 20),
  // Module 49's external feedback queue (functions/src/sharing/
  // submitExternalComment.js), scoped per share like postReporterMessage is
  // scoped per case - so several people behind one NAT can each still send
  // their own note. Occasional feedback, not a high-frequency endpoint like
  // getSharedCase/accessSharedEvidence, so this stays tight.
  submitExternalComment: limit('submitExternalComment', 'RATE_LIMIT_SUBMIT_EXTERNAL_COMMENT', 5),
}

// Resolves a configured limit to a usable number. Anything that is not a
// positive integer - an unmaterialized param (0), a typo'd override, a
// negative - falls back to the designed value and says so in the log, so a
// misconfiguration is visible without being an outage.
function resolveLimit(entry) {
  const configured = Number(entry.param.value())
  if (Number.isFinite(configured) && configured > 0) return configured
  logger.warn('rateLimit: limit not configured, using built-in default', {
    endpoint: entry.name,
    fallback: entry.fallback,
  })
  return entry.fallback
}

// Hard ceiling on how many messages one case can ever accumulate from its
// reporter. The hourly limit above bounds the rate; this bounds the total, so
// a single case cannot be used as an unbounded pipe into the Claude API by
// someone willing to wait. 100 is far above any real conversation.
const maxReporterMessagesPerCase = defineInt('MAX_REPORTER_MESSAGES_PER_CASE', { default: 100 })

// ---------------------------------------------------------------------------
// Caller fingerprint
// ---------------------------------------------------------------------------
//
// WHY THIS IS NOT A TRACKING MECHANISM, and why that matters more here than in
// most systems: the people this fingerprint is computed for are whistleblowers.
// A durable identifier for an anonymous reporter would be a re-identification
// vector sitting inside the very product that promises them anonymity, and it
// would be one that survives in Firestore for anyone with read access to find.
//
// Four properties keep it from being one:
//
//   * Coarse. The IP is truncated to a /24 (IPv4) or /48 (IPv6) before it is
//     hashed, so the input is a neighbourhood or an office, never a device.
//   * Salted. HMAC with a deploy-time secret salt means the stored value
//     cannot be reversed or rainbow-tabled back to an IP by anyone who later
//     reads the collection.
//   * Rotating. The salt is combined with the current UTC date, so the same
//     network hashes to a different value tomorrow. Two visits a week apart
//     are unlinkable even to us.
//   * Short-lived. Counter documents carry expiresAt and are removed by a
//     Firestore TTL policy on that field (set the policy on
//     rateLimits.expiresAt at deploy time). Nothing accumulates into a history.
//
// The result is a value that can answer "has this rough origin called 4 times
// in the last hour" and cannot answer "who is this" or "have they been here
// before". If you ever find yourself wanting to widen any of the four
// properties above to make a limit sharper, the answer is a different limit,
// not a sharper fingerprint.
const fingerprintSalt = defineString('RATE_LIMIT_SALT', { default: 'rectifia-dev-salt' })

function coarsenIp(ip) {
  if (!ip) return 'unknown'
  const address = String(ip).trim()
  if (address.includes(':')) {
    // IPv6 -> first three hextets, i.e. the /48 an end site is allocated.
    return address.split(':').slice(0, 3).join(':')
  }
  const octets = address.split('.')
  if (octets.length !== 4) return 'unknown'
  return `${octets[0]}.${octets[1]}.${octets[2]}.0`
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

function utcDateStamp() {
  return new Date().toISOString().slice(0, 10)
}

// An authenticated caller is fingerprinted by uid instead - a staff member
// already has a durable identity in the system, so there is nothing to protect
// by coarsening, and a per-account limit is both fairer and more accurate than
// a per-network one.
function callerFingerprint(request) {
  const uid = request?.auth?.uid
  const basis = uid ? `uid:${uid}` : `net:${coarsenIp(callerIp(request))}`
  return crypto
    .createHmac('sha256', `${fingerprintSalt.value()}:${utcDateStamp()}`)
    .update(basis)
    .digest('hex')
    .slice(0, 32)
}

// ---------------------------------------------------------------------------
// The limiter
// ---------------------------------------------------------------------------

// Deliberately identical for every endpoint and every reason. A caller must
// not be able to tell "you are rate limited on submitCase" from "you are rate
// limited on validateCaseAccess", and above all must not be able to tell a
// throttle apart from a wrong passcode - a limit that only trips on real Case
// IDs would itself be an oracle for which Case IDs exist.
function tooManyRequests() {
  return new HttpsError(
    'resource-exhausted',
    'Too many requests. Please wait a few minutes and try again.'
  )
}

// Fixed window rather than sliding: one document read/write per call instead of
// a per-request history, which keeps the limiter itself cheap. The tradeoff -
// a caller can spend one window's budget at the end of a window and the next
// at the start of the following one - is acceptable for limits whose purpose
// is bounding cost and brute force, not smoothing traffic.
//
// `scope` overrides the caller fingerprint when the thing being limited is a
// resource rather than a caller: postReporterMessage limits per case, so that
// twenty people behind one NAT can each hold their own conversation while a
// single case still cannot be driven in circles.
async function enforceRateLimit(firestore, endpoint, request, { scope, windowMs = HOUR_MS } = {}) {
  const entry = limits[endpoint]
  if (!entry) {
    // A programming error, not a runtime condition: the endpoint name is a
    // literal at every call site.
    throw new Error(`enforceRateLimit: no limit configured for '${endpoint}'`)
  }
  const max = resolveLimit(entry)

  const key = scope ? `scope:${scope}` : callerFingerprint(request)
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs
  const ref = firestore
    .collection(RATE_LIMITS_COLLECTION)
    .doc(`${endpoint}__${key}__${windowStart}`)

  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const count = snapshot.exists ? snapshot.data().count || 0 : 0
    if (count >= max) {
      throw tooManyRequests()
    }
    tx.set(
      ref,
      {
        count: count + 1,
        endpoint,
        windowStart: admin.firestore.Timestamp.fromMillis(windowStart),
        // Read by the Firestore TTL policy. Two windows of slack so a document
        // is never deleted while its own window is still open.
        expiresAt: admin.firestore.Timestamp.fromMillis(windowStart + windowMs * 2),
      },
      { merge: true }
    )
  })
}

// Total-messages-per-case ceiling, checked alongside the hourly limit in
// postReporterMessage. Uses an aggregate count so it stays a single billed
// read no matter how long the thread is, and counts only reporter messages -
// an investigator working a case must never be able to lock the reporter out
// of replying by filling the thread.
const DEFAULT_MAX_REPORTER_MESSAGES = 100

async function enforceCaseMessageCap(caseRef) {
  // Same fallback reasoning as resolveLimit above.
  const configured = Number(maxReporterMessagesPerCase.value())
  const cap =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_REPORTER_MESSAGES
  const snapshot = await caseRef
    .collection('messages')
    .where('sender', '==', 'reporter')
    .count()
    .get()
  if (snapshot.data().count >= cap) {
    throw tooManyRequests()
  }
}

// Applied to every callable a reporter or a roster employee can reach without
// signing in.
//
// TESTING: App Check enforcement is currently OFF. With enforceAppCheck true
// these calls are rejected before the handler runs unless they carry a valid
// attestation token; with it false anything that can reach the endpoint gets
// through, and the fixed-window counter below is the only control left on
// callables that have no Firebase Auth to fall back on. Flip this back to true
// (and restore the client half in src/services/firebase.js) before any
// deployment that takes real reports.
const PUBLIC_CALLABLE_OPTIONS = { enforceAppCheck: false }

module.exports = {
  RATE_LIMITS_COLLECTION,
  PUBLIC_CALLABLE_OPTIONS,
  HOUR_MS,
  enforceRateLimit,
  enforceCaseMessageCap,
  callerFingerprint,
  tooManyRequests,
}
