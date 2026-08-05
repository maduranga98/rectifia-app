const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const crypto = require('crypto')
const {
  CASES_COLLECTION,
  randomPasscode,
  hashPasscode,
  generateUniqueCaseId,
} = require('./generateCaseAccess')
const {
  INTAKE_METHODS,
  BACKDATE_WARNING_DAYS,
  requireTier,
  requireCategory,
  requireResponses,
} = require('./submitCase')
const { requireAuthUid, requireIntakeRole } = require('../utils/staffAuth')
const { encryptionKeySecret, encryptIdentity } = require('../utils/identityVault')

if (!admin.apps.length) {
  admin.initializeApp()
}

const STAFF_INTAKE_LOG_COLLECTION = 'staffIntakeAuditLog'
const DAY_MS = 24 * 60 * 60 * 1000

// The identity fields this form collects, and the only keys that ever go
// into the vault envelope. An allowlist rather than "whatever the client
// sent" - an unbounded identity map would let a future client version start
// storing things nobody agreed to encrypt, describe, or eventually delete.
const IDENTITY_FIELDS = ['name', 'email', 'phone', 'jobTitle', 'notes']
const MAX_IDENTITY_FIELD_LENGTH = 500

// The staff member types this on a web form, so it arrives as an epoch
// millisecond value. Anything else is rejected outright rather than coerced -
// a silently mis-parsed date here sets a regulatory clock to the wrong time.
function parseReportedAt(value) {
  const ms = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(ms)) {
    throw new HttpsError(
      'invalid-argument',
      'A valid date the report was received is required'
    )
  }
  // Small tolerance for clock skew between the staff member's browser and
  // the server; anything genuinely in the future is a typo, and accepting it
  // would push acknowledgmentDueAt / feedbackDueAt out past their real
  // deadlines.
  const now = Date.now()
  if (ms > now + 60_000) {
    throw new HttpsError(
      'invalid-argument',
      'The date this report was received cannot be in the future'
    )
  }
  return ms
}

// Only the *keys* on file, never the values - this is what makes it possible
// to tell a reader "we hold a name and an email for this reporter" without
// decrypting anything or logging what they say.
function identityFieldsOnFile(identity) {
  return IDENTITY_FIELDS.filter((field) => {
    const value = identity?.[field]
    return typeof value === 'string' && value.trim().length > 0
  })
}

function buildIdentityPayload(identity) {
  const payload = {}
  for (const field of IDENTITY_FIELDS) {
    const value = identity?.[field]
    if (typeof value !== 'string' || !value.trim()) continue
    if (value.length > MAX_IDENTITY_FIELD_LENGTH) {
      throw new HttpsError(
        'invalid-argument',
        `Reporter ${field} is too long (max ${MAX_IDENTITY_FIELD_LENGTH} characters)`
      )
    }
    payload[field] = value.trim()
  }
  return payload
}

// Every case filed on behalf of someone else is an audited event, the same
// rule triageAccessLog enforces for reading an unassigned case and
// identityAccessAuditLog enforces for decrypting one. It carries who filed,
// for which company, by what method, at what tier - and never a single
// identity value or questionnaire answer, so the audit trail can be read
// freely by an auditor without itself becoming a second copy of the case.
// firestore.rules denies every client read and write of this collection.
async function logStaffIntake(firestore, entry) {
  await firestore.collection(STAFF_INTAKE_LOG_COLLECTION).add({
    ...entry,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Creates a case from a report a staff member took by phone, by email, or
// across a desk. The reporter never touched a keyboard, so this is the only
// case-creating path that is authenticated - and the authentication is the
// point: submitCase.js can be anonymous because a reporter filing their own
// report proves nothing about anyone else, while typing up someone else's
// report is an act that has to be attributable.
//
// What it deliberately does NOT change:
//
//   - The case document it writes is the same shape submitCase.js writes, so
//     scoreCase.js's onCreate trigger scores it, routeCase.js routes it (with
//     its conflict-of-interest check intact - a staff member typing the case
//     in is not a reason to trust the company's own routing target), and
//     scheduleDeadlines.js gives it deadlines and posts the acknowledgment.
//     None of that pipeline is duplicated or bypassed here.
//   - The reporter still gets a Case ID and passcode, and therefore the same
//     thread, the same tracking page, and the same ability to add information
//     the investigator never asked for. They are not a lesser participant for
//     having phoned it in; the credentials are returned once, to the staff
//     member, to hand over.
//   - An hrCoordinator who files a case gains nothing on it. There is no
//     "creator" exception written anywhere: they keep their metadata-only
//     read via caseMetadata, and the case routes to a Case Handler like any
//     other. `enteredByUid` below is provenance, not an ACL entry - nothing
//     reads it to grant access.
exports.createCaseOnBehalf = onCall({ secrets: [encryptionKeySecret] }, async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  // Role first, before anything in the request body is even looked at: this
  // rejects a companyAdmin (see INTAKE_ROLES in utils/staffAuth.js) without
  // that account's request ever reaching the identity-handling code below.
  const { companyId, role } = await requireIntakeRole(firestore, request, uid)

  const {
    category,
    responses,
    tier,
    intakeMethod,
    reportedAt,
    reporterInformedOfTier,
    reporterIdentity,
  } = request.data || {}

  requireCategory(category)
  requireResponses(responses)
  const resolvedTier = requireTier(tier)

  if (typeof intakeMethod !== 'string' || !INTAKE_METHODS.has(intakeMethod)) {
    throw new HttpsError(
      'invalid-argument',
      'A valid intake method is required (email, phone, in person, or manager referral)'
    )
  }
  // 'web' is what a reporter filing their own report gets. A staff member
  // choosing it here would mean "the reporter used the web form", in which
  // case there is nothing to file on their behalf.
  if (intakeMethod === 'web') {
    throw new HttpsError(
      'invalid-argument',
      'Reports filed through the web form are submitted by the reporter, not on their behalf'
    )
  }

  const reportedAtMs = parseReportedAt(reportedAt)
  const backdatedDays = Math.floor((Date.now() - reportedAtMs) / DAY_MS)

  // The reporter has to have been told what tier means before a staff member
  // records a choice on their behalf - the choice is the reporter's, and an
  // unconfirmed one is an assumption written into a compliance record. The
  // form makes this an explicit checkbox; the server refuses without it, so
  // it cannot be dropped by a client that forgets to render it.
  if (reporterInformedOfTier !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Confirm that the reporter was told what anonymous and confidential mean before filing'
    )
  }

  let identityPayload = null
  let fieldsOnFile = []
  if (resolvedTier === 'confidential') {
    identityPayload = buildIdentityPayload(reporterIdentity)
    fieldsOnFile = identityFieldsOnFile(identityPayload)
    if (fieldsOnFile.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'A confidential-tier case needs at least one reporter identity detail - otherwise file it as anonymous'
      )
    }
  }

  const caseId = await generateUniqueCaseId(firestore)
  const passcode = randomPasscode()
  const passcodeSalt = crypto.randomBytes(16).toString('hex')
  const passcodeHash = hashPasscode(passcode, passcodeSalt)

  const caseDoc = {
    caseId,
    companyId,
    passcodeHash,
    passcodeSalt,
    category,
    responses,
    status: 'open',
    tier: resolvedTier,
    source: 'staff',
    intakeMethod,
    reportedAt: admin.firestore.Timestamp.fromMillis(reportedAtMs),
    enteredByUid: uid,
    enteredByRole: role,
    reporterInformedOfTier: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // Explicit null, not an absent field: functions/src/retention/
    // applyRetention.js's Tier 1 sweep queries identityPurgedAt == null,
    // which only matches documents where the field genuinely exists.
    identityPurgedAt: null,
  }

  // Anonymous tier writes no identity key at all - not an empty object, not a
  // null. `'reporterIdentity' in caseData` is therefore a true answer to
  // "does this case hold an identity", with no encrypted-empty-string case to
  // reason about, and nothing for a future reader to try to decrypt.
  if (identityPayload) {
    // The plaintext exists only inside this function invocation. What lands
    // in Firestore is the AES-GCM envelope from identityVault.js; getting it
    // back requires the Secret Manager key AND a live Super Admin session AND
    // a documented reason, all three, with the attempt logged either way
    // (see decryptIdentity there). Nothing in this module can decrypt what it
    // just wrote, deliberately - there is no admin-can-read-anything path
    // being opened here.
    caseDoc.reporterIdentity = {
      vault: encryptIdentity(identityPayload),
      // Key names only. This is what lets a report say "a name and a phone
      // number are on file" without a decrypt, which is almost always the
      // question being asked.
      fieldsOnFile,
      storedAt: admin.firestore.Timestamp.now(),
      storedByUid: uid,
    }
  }

  await firestore.collection(CASES_COLLECTION).doc(caseId).set(caseDoc)

  await logStaffIntake(firestore, {
    caseId,
    companyId,
    actorUid: uid,
    actorRole: role,
    actorEmail: request.auth?.token?.email ?? null,
    action: 'case_created_on_behalf',
    intakeMethod,
    tier: resolvedTier,
    // Presence and shape of the identity record, never its contents.
    identityStored: Boolean(identityPayload),
    identityFieldsOnFile: fieldsOnFile,
    reporterInformedOfTier: true,
    reportedAt: admin.firestore.Timestamp.fromMillis(reportedAtMs),
    backdatedDays,
  })

  if (backdatedDays > BACKDATE_WARNING_DAYS) {
    // A warning, not a rejection: a genuinely old report still has to be
    // enterable, and refusing it would push staff toward backdating it to
    // something the form accepts - which is worse than recording the truth
    // and flagging it. The deadlines scheduleDeadlines.js computes will
    // already be in the past, which is the honest state of that case.
    logger.warn('createCaseOnBehalf: report received well before it was entered', {
      caseId,
      companyId,
      backdatedDays,
    })
  }

  return {
    caseId,
    passcode,
    tier: resolvedTier,
    backdatedDays,
    // Surfaced so the form can tell the staff member their compliance clock
    // started when the report arrived, not when they typed it up.
    backdateWarning: backdatedDays > BACKDATE_WARNING_DAYS,
  }
})

// Exported so functions/src/intake/identityTransition.js can apply the exact
// same identity allowlist, length cap, and fields-on-file derivation when a
// reporter identifies themselves mid-case (Blueprint §7.2). A second copy of
// IDENTITY_FIELDS living in that module would be free to drift - one path
// would start accepting a field the other rejects, and the two would disagree
// about what "a name and a phone number are on file" means.
exports.IDENTITY_FIELDS = IDENTITY_FIELDS
exports.buildIdentityPayload = buildIdentityPayload
exports.identityFieldsOnFile = identityFieldsOnFile
