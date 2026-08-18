const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const {
  CASES_COLLECTION,
  randomPasscode,
  hashPasscode,
  generateUniqueCaseId,
} = require('./generateCaseAccess')
const { resolveCompanyBySlug } = require('../company/resolveCompanySlug')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

// The categories a case may be filed under. Mirrors the keys of
// src/data/categories.js / the questionnaires in src/data/questionnaires - a
// case whose category isn't one of these has no questionnaire and nothing
// downstream can score it, so it's rejected here rather than written as a
// dead document.
const KNOWN_CATEGORIES = new Set([
  'harassment',
  'toxicManagement',
  'discrimination',
  'retaliation',
  'burnout',
])

// How much the system is allowed to know about who filed.
//
// 'anonymous' means no identity field is written at all - not encrypted, not
// blank, absent. There is nothing on the document to decrypt, subpoena, or
// leak, which is the only version of anonymity worth offering.
// 'confidential' means an identity was given, and it goes through
// functions/src/utils/identityVault.js before it touches Firestore.
//
// Read side: a case document written before this field existed has no `tier`,
// and every reader treats a missing tier as 'anonymous' (normalizeTier below,
// pickMetadata in syncCaseMetadata.js, generateReport.js). That is the safe
// direction to default - an old case carries no identity data, so reading it
// as anonymous is not a guess, it is a description. No migration is written
// for the same reason: there is nothing to move, only a default to agree on.
const TIERS = new Set(['anonymous', 'confidential'])
const DEFAULT_TIER = 'anonymous'

// How the report physically reached the company. 'web' is the reporter
// filling in the form themselves; the rest are a staff member typing up a
// report that arrived some other way (see createCaseOnBehalf.js). 'phone'
// means exactly that - a person writing down a phone conversation - not a
// recorded or transcribed channel, which this module does not build.
const INTAKE_METHODS = new Set([
  'web',
  'email',
  'phone',
  'in_person',
  'manager_referral',
])

const SOURCES = new Set(['reporter', 'staff'])

// A report that "arrived" after now is a data-entry error or a clock-skewed
// client, and it would push a regulatory deadline into the future. Rejected.
// A report from well before now is plausible (a backlog being entered, a
// case escalated late) but worth surfacing, so it is warned about rather
// than blocked - see createCaseOnBehalf.js.
const BACKDATE_WARNING_DAYS = 30

// A case doc with no `tier` predates the field; treat it as anonymous.
function normalizeTier(tier) {
  return TIERS.has(tier) ? tier : DEFAULT_TIER
}

// Shared by both intake paths, so the two can never disagree about what a
// valid tier is.
function requireTier(tier) {
  if (typeof tier !== 'string' || !TIERS.has(tier)) {
    throw new HttpsError(
      'invalid-argument',
      "A reporting tier of 'anonymous' or 'confidential' is required"
    )
  }
  return tier
}

function requireCategory(category) {
  if (typeof category !== 'string' || !KNOWN_CATEGORIES.has(category)) {
    throw new HttpsError('invalid-argument', 'A valid case category is required')
  }
  return category
}

function requireResponses(responses) {
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'At least one questionnaire response is required'
    )
  }
  return responses
}

// The reporter's acknowledgment of the pre-submission data-handling notice
// (src/components/intake/DataHandlingNotice.jsx, shown at category selection
// - before any case content is typed, deliberately not at final submit).
// Required, the same "the server refuses without it, so it cannot be dropped
// by a client that forgets to render it" reasoning requireTier already
// applies to the tier choice: an auditor asking "was this reporter told
// their text goes to an AI sub-processor" needs a record that exists because
// the server would not accept a case without one, not an assurance that the
// UI always shows the notice.
//
// acknowledgedAt and policyVersion are taken as the client reports them
// (this is a consent record about what a reporter saw and did in their own
// browser, not a security boundary) but their shape is still validated, so a
// malformed or missing value fails the same way a missing tier does rather
// than silently writing a useless record.
function requireDataHandlingAcknowledgment(value) {
  const acknowledgedAt = typeof value?.acknowledgedAt === 'string' ? value.acknowledgedAt : null
  const policyVersion =
    typeof value?.policyVersion === 'string' && value.policyVersion.trim()
      ? value.policyVersion.trim()
      : null
  if (value?.acknowledged !== true || !acknowledgedAt || !policyVersion) {
    throw new HttpsError(
      'failed-precondition',
      'Confirm the data-handling notice before filing a report'
    )
  }
  return { acknowledged: true, acknowledgedAt, policyVersion }
}

// Files a completed reporter questionnaire as a new case. This is the
// reporter's own path into the system, and it deliberately requires no auth -
// reporters are anonymous and unauthenticated by design. Staff filing on
// someone's behalf go through createCaseOnBehalf.js instead, which is
// authenticated; both write the same shape of case document, so nothing
// downstream (scoring, routing, deadlines, the reporter's thread) can tell
// them apart except by the `source` field they each stamp.
//
// The passcode is generated server-side (only its salted hash is stored) and
// returned once in this response; there is no recovery. Crucially, the
// category and responses collected by QuestionnaireForm are written onto the
// case at creation time, so scoreCase.js's onCreate trigger has the data it
// needs on the very first fire.
//
// The reporter's link carries a company slug, not a companyId. We resolve the
// slug to a companyId here, server-side, and never trust a companyId sent by
// the client - a spoofed one would let a reporter file into another company's
// queue. companyId is what routeCase.js and the company-scoped dashboards (HR
// Coordinator, Case Handler) key on to find their cases, so a case written
// without it is effectively invisible to the company; that's why an
// unresolvable slug is rejected here rather than written as an orphan case.
exports.submitCase = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { category, responses, companySlug, tier, dataHandlingAcknowledgment } = request.data || {}

  // Filing a case is the most expensive unauthenticated action in the system:
  // it writes a case, which fires scoreCase.js and then aiFollowUp.js, each a
  // paid Claude call. Limited before any validation runs so the limiter cannot
  // be probed for which slugs or categories are real.
  await enforceRateLimit(admin.firestore(), 'submitCase', request)

  requireCategory(category)
  requireResponses(responses)

  // The reporter chose this themselves on the last step of Submit.jsx, after
  // being shown the trade-off in plain language. It is required rather than
  // defaulted so a client that never asked the question cannot quietly file
  // someone as anonymous when they meant otherwise, or the reverse.
  const resolvedTier = requireTier(tier)
  const acknowledgment = requireDataHandlingAcknowledgment(dataHandlingAcknowledgment)

  if (typeof companySlug !== 'string' || !companySlug.trim()) {
    throw new HttpsError('invalid-argument', 'A company slug is required')
  }

  const company = await resolveCompanyBySlug(companySlug)
  if (!company) {
    throw new HttpsError('not-found', 'This reporting link is not valid')
  }
  // A suspended company (Super Admin action, non-payment or offboarding -
  // see companyService.js's setCompanySuspended) blocks new intake but must
  // never delete or hide anything that already exists: this is the one place
  // that check applies, before a case is ever written. Existing cases,
  // reporter threads, and every other read/write path are untouched.
  if (company.suspended) {
    throw new HttpsError(
      'failed-precondition',
      'This organization is not currently accepting new reports. Please contact them directly.'
    )
  }

  const firestore = admin.firestore()

  const caseId = await generateUniqueCaseId(firestore)
  const passcode = randomPasscode()
  const passcodeSalt = crypto.randomBytes(16).toString('hex')
  const passcodeHash = hashPasscode(passcode, passcodeSalt)

  // A confidential-tier self-submission records the reporter's *choice* and
  // nothing else: this flow never asks for a name, email, or phone number, so
  // there is no identity to vault. The tier still matters - it is the
  // reporter's standing answer to "may the investigator know who you are",
  // and it is what generateReport.js keys its restricted-identity section on.
  await firestore
    .collection(CASES_COLLECTION)
    .doc(caseId)
    .set({
      caseId,
      companyId: company.companyId,
      passcodeHash,
      passcodeSalt,
      category,
      responses,
      status: 'open',
      tier: resolvedTier,
      source: 'reporter',
      intakeMethod: 'web',
      // Proof the reporter was told, before they wrote a word of their
      // report, that it would be processed by an AI sub-processor and what
      // their chosen identity tier does and does not conceal - see
      // DataHandlingNotice.jsx and requireDataHandlingAcknowledgment above.
      // An auditor asking "was this reporter told" gets this record, not an
      // assurance that the UI always shows the notice.
      dataHandlingAcknowledgment: acknowledgment,
      // The report reached the company the moment it was filed, so the two
      // timestamps are the same thing here by definition. They diverge only
      // for a staff-entered case catching up with a report received earlier -
      // which is exactly why scheduleDeadlines.js reads reportedAt rather
      // than createdAt.
      reportedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      // Explicit null, not an absent field: functions/src/retention/
      // applyRetention.js's Tier 1 sweep queries identityPurgedAt == null,
      // which only matches documents where the field genuinely exists.
      identityPurgedAt: null,
    })

  return { caseId, passcode }
})

exports.KNOWN_CATEGORIES = KNOWN_CATEGORIES
exports.TIERS = TIERS
exports.DEFAULT_TIER = DEFAULT_TIER
exports.INTAKE_METHODS = INTAKE_METHODS
exports.SOURCES = SOURCES
exports.BACKDATE_WARNING_DAYS = BACKDATE_WARNING_DAYS
exports.normalizeTier = normalizeTier
exports.requireTier = requireTier
exports.requireCategory = requireCategory
exports.requireResponses = requireResponses
exports.requireDataHandlingAcknowledgment = requireDataHandlingAcknowledgment
