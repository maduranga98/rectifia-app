const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { verifyReporterAccess } = require('./caseThread')
const { normalizeTier } = require('./submitCase')
const { buildIdentityPayload, identityFieldsOnFile } = require('./createCaseOnBehalf')
const {
  encryptionKeySecret,
  encryptIdentity,
  writeIdentityAuditEntry,
} = require('../utils/identityVault')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Blueprint §7.2 and §8: the two transitions a reporter - and only a reporter -
// can make from inside their own case thread.
//
//   A. anonymous -> confidential (progressive reveal)
//   B. add / remove an optional contact email
//
// Both are reporter-initiated by construction, not by convention: every
// callable here is authenticated by Case ID + passcode and nothing else, so
// there is no code path by which staff, the AI, or a scheduled job could
// perform either one. There is deliberately no staff-facing "request identity"
// callable to pair with these - an investigator who wants a reporter's name
// asks in the thread, in their own words, and the reporter's answer is their
// own. A button that sent a prompt on the investigator's behalf would turn a
// voluntary disclosure into a request from the person deciding the outcome.
//
// Direction is one-way for the identity and two-way for the address, and the
// asymmetry is the point:
//   - The identity, once vaulted, is evidence in a live investigation. A
//     "revert" that left the ciphertext in place would be a lie to the
//     reporter; one that deleted it would destroy evidence mid-case. So the
//     honest design is no undo at all, stated plainly before they commit
//     (see src/components/intake/IdentityPanel.jsx).
//   - The contact email is not evidence. It is a delivery address, and
//     removeContactEmail deletes the ciphertext outright. That withdrawal
//     right is what makes offering the channel acceptable in the first place.

const CASES_COLLECTION = 'cases'
const MESSAGES_SUBCOLLECTION = 'messages'
const MAX_EMAIL_LENGTH = 254

// Content-free by design. These strings land in the case timeline, which the
// reporter and the assigned handler both read, and their whole job is to make
// the change legible - "something about identity changed here, on this date" -
// without restating the thing that changed. A system message that named the
// reporter would put the plaintext into the one part of the case that is
// deliberately never encrypted.
const SYSTEM_MESSAGES = {
  reporterSelfReveal:
    'The reporter chose to identify themselves on this case. The case is now confidential tier rather than anonymous. Their details are held in the identity vault and are not readable from the case record; access requires an authorised reveal with a documented reason, which is logged.',
  reporterIdentityProvided:
    'The reporter added their identity to this case. The case was already confidential tier, so nothing about it changed. Their details are held in the identity vault and are not readable from the case record; access requires an authorised reveal with a documented reason, which is logged.',
  contactEmailAdded:
    'The reporter added a contact address so they can be notified of updates. The address is encrypted and is not readable from the case record. Notifications sent to it contain no case details.',
  contactEmailRemoved:
    'The reporter removed the contact address they had added. It has been deleted, and no further notifications will be sent to it.',
}

// A closed case is a finished record. Letting either transition land on one
// would mean appending to a case nobody is working, and in the identity's case
// vaulting a name for an investigation that has already concluded - a
// disclosure with no purpose left to serve.
function requireOpenCase(caseData) {
  if (caseData.status === 'closed') {
    throw new HttpsError(
      'failed-precondition',
      'This case is closed, so it can no longer be changed'
    )
  }
}

// Deliberately permissive: an address that fails delivery is a bounced email,
// while an address wrongly rejected here is a reporter told their real contact
// details are invalid. The only hard requirements are that it is a single
// address, has an @ with something on both sides, and is short enough to store.
function normalizeEmail(email) {
  if (typeof email !== 'string') {
    throw new HttpsError('invalid-argument', 'An email address is required')
  }
  const trimmed = email.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address')
  }
  if (!/^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$/.test(trimmed)) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address')
  }
  return trimmed
}

async function appendSystemMessage(caseRef, text) {
  await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    // 'system' is its own sender, distinct from 'ai' | 'investigator' |
    // 'reporter'. No client can post one: postReporterMessage hardcodes
    // sender 'reporter', and postInvestigatorMessage hardcodes 'investigator'
    // and restricts `type` to VALID_MESSAGE_TYPES, which does not include this
    // one. A system message is therefore always genuinely the system's.
    sender: 'system',
    type: 'system',
    text,
    attachments: [],
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// The accountability half of every transition. The thread message above is
// what makes a change legible in the case timeline; this is what makes it
// answerable later - it lands in the same identityAccessAuditLog that records
// every decrypt, so "what has ever happened to this case's identity data" is
// one query rather than a join across logs.
//
// actorUid is null and authorizedAs is 'reporter' because that is the literal
// truth: the actor holds a Case ID and a passcode and has no account. Recording
// a staff uid here - or leaving the field to be inferred - would misattribute a
// reporter's own decision to whoever happened to be assigned.
async function logTransition(firestore, { caseId, action, detail }) {
  await writeIdentityAuditEntry(firestore, {
    action,
    actorUid: null,
    actorEmail: null,
    authorizedAs: 'reporter',
    caseId,
    field: action.startsWith('contact_email') ? 'contactEmail' : 'reporterIdentity',
    reason: 'Reporter-initiated change from their own case view',
    outcome: 'granted',
    detail: detail ?? null,
  })
}

// Shared front door for all three callables: rate limit, verify the passcode,
// refuse a closed case. The caseId is never trusted on its own - the passcode
// is checked against the case's own salted hash exactly as
// postReporterMessage does, so holding a Case ID is not holding a case.
//
// The limit is scoped to the case rather than the caller, consistent with
// postReporterMessage: these actions belong to a case, and limiting by network
// would throttle unrelated reporters behind one office NAT while leaving a
// single case drivable from many networks. It runs after the passcode check
// for the same reason it does there - a caller who does not hold the case sees
// the generic permission-denied either way and can never observe the limiter,
// so it cannot be turned into an oracle for which Case IDs exist.
async function openTransition(firestore, endpoint, request) {
  const { caseId, passcode } = request.data || {}
  const snapshot = await verifyReporterAccess(firestore, caseId, passcode)
  await enforceRateLimit(firestore, endpoint, request, { scope: `case:${caseId}` })

  const caseData = snapshot.data()
  requireOpenCase(caseData)
  return { caseRef: snapshot.ref, caseData }
}

// ---------------------------------------------------------------------------
// A. Providing an identity: anonymous -> confidential, or filling an empty
//    vault on a case that was already filed confidential
// ---------------------------------------------------------------------------

// Two reporters land here through different doors but the same callable:
// one filed anonymously and has since decided the investigator should know
// who they are; the other chose "be identifiable to the investigator only"
// at submission - which only records the choice, per Submit.jsx - and is now
// supplying the details that choice implied. Nothing prompts either one: the
// panel that calls this sits collapsed at the foot of their own case view
// and is offered to nobody else.
//
// The dividing line is not the case's tier, it is whether an identity is
// already on file. A confidential-tier case with an empty vault has nothing
// stored yet, so the write is still allowed; a case with an identity already
// vaulted - either tier - has nothing left to add.
//
// What lands on the case is the same shape createCaseOnBehalf.js writes for a
// staff-filed confidential case - an AES-GCM envelope plus the *key names* on
// file - so every downstream reader (generateReport.js, revealIdentity.js)
// treats it through the exact same path it already knows. Nothing here can
// read back what it just wrote.
exports.upgradeToConfidential = onCall(
  { ...PUBLIC_CALLABLE_OPTIONS, secrets: [encryptionKeySecret] },
  async (request) => {
    const { caseId, identity } = request.data || {}
    const firestore = admin.firestore()
    const { caseRef, caseData } = await openTransition(firestore, 'upgradeToConfidential', request)

    const currentTier = normalizeTier(caseData.tier)

    // An identity already on file - at either tier: a no-op, not an error. A
    // reporter who taps twice, or returns to a stale tab, has asked for a
    // state the case is already in - there is nothing to correct and nothing
    // to warn them about. Erroring would also make the second call
    // distinguishable from the first, which is a state oracle for no benefit.
    if (caseData.reporterIdentity) {
      return { tier: currentTier, changed: false }
    }

    const identityPayload = buildIdentityPayload(identity)
    const fieldsOnFile = identityFieldsOnFile(identityPayload)
    if (fieldsOnFile.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'Enter at least one detail so the investigator knows who you are'
      )
    }

    // An upgrade if the case was anonymous; otherwise the case was already
    // confidential (chosen at submission) and this is simply filling in what
    // that choice promised, so the tier does not move.
    const isUpgrade = currentTier !== 'confidential'

    const update = {
      reporterIdentity: {
        vault: encryptIdentity(identityPayload),
        // Key names only - what lets a report say "a name and a phone number
        // are on file" without a decrypt, which is almost always the question.
        fieldsOnFile,
        storedAt: admin.firestore.Timestamp.now(),
        // No storedByUid: nobody stored this on the reporter's behalf.
        storedBy: 'reporter',
      },
    }
    if (isUpgrade) {
      update.tier = 'confidential'
      // Recorded separately from storedAt because a later reader needs to know
      // this case *changed* tier rather than started at it. An investigator
      // reading a report where the reporter was confidential from the first
      // message is reading a different case from one where they were anonymous
      // for three weeks first, and flattening the two loses that.
      update.tierChangedAt = admin.firestore.FieldValue.serverTimestamp()
      update.tierChangedBy = 'reporter'
    }

    await caseRef.update(update)

    await appendSystemMessage(
      caseRef,
      isUpgrade ? SYSTEM_MESSAGES.reporterSelfReveal : SYSTEM_MESSAGES.reporterIdentityProvided
    )
    await logTransition(firestore, {
      caseId,
      action: isUpgrade ? 'reporter_self_reveal' : 'reporter_identity_provided',
      // Presence and shape, never a value.
      detail: `fieldsOnFile: ${fieldsOnFile.join(', ')}`,
    })

    return { tier: 'confidential', changed: true, fieldsOnFile }
  }
)

// ---------------------------------------------------------------------------
// B. Optional contact email
// ---------------------------------------------------------------------------

// Adds a delivery address for update notifications. It does NOT change tier,
// and that is not an oversight: staff have no read path to this field, in
// ciphertext or otherwise, so an anonymous case with a contact address is still
// an anonymous case to everyone working it.
//
// What it does change is the truth of the word "anonymous" in the absolute
// sense, because a stored mapping between an address and a case now exists
// where none did before. The reporter is told exactly that, in those words,
// before the field is shown (Blueprint §8) - the encryption is a real
// protection but it is not the same promise as "there is nothing to protect".
exports.addContactEmail = onCall(
  { ...PUBLIC_CALLABLE_OPTIONS, secrets: [encryptionKeySecret] },
  async (request) => {
    const { caseId, email } = request.data || {}
    const firestore = admin.firestore()
    const { caseRef, caseData } = await openTransition(firestore, 'addContactEmail', request)

    // Replacing an address is out of scope on purpose - remove, then add, is
    // the supported path. That way a change is two audited events with the
    // ciphertext genuinely deleted in between, rather than one event that
    // silently overwrites an address the reporter may have forgotten was there.
    if (caseData.contactEmail) {
      throw new HttpsError(
        'failed-precondition',
        'A contact address is already set for this case. Remove it first if you want to use a different one.'
      )
    }

    const normalized = normalizeEmail(email)

    await caseRef.update({
      contactEmail: { vault: encryptIdentity(normalized) },
      contactEmailAddedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    await appendSystemMessage(caseRef, SYSTEM_MESSAGES.contactEmailAdded)
    await logTransition(firestore, { caseId, action: 'contact_email_added' })

    return { hasContactEmail: true }
  }
)

// Withdraws the channel. This is the counterweight that makes offering it
// acceptable at all: a reporter who changes their mind gets the mapping
// deleted, not disabled. FieldValue.delete() removes the ciphertext from the
// document rather than blanking it, so `'contactEmail' in caseData` stays a
// true answer to "is there an address on file" with no empty-envelope state to
// reason about - the same rule createCaseOnBehalf.js follows for an anonymous
// case's absent reporterIdentity.
//
// The lastTemplateId is cleared with it: it exists only to keep the decoy
// rotation from repeating, and keeping a send history for a channel that no
// longer exists would be a trace of notifications for no reason.
exports.removeContactEmail = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { caseId } = request.data || {}
  const firestore = admin.firestore()
  const { caseRef, caseData } = await openTransition(firestore, 'removeContactEmail', request)

  // Nothing on file: a no-op, for the same reason the tier check above is one.
  if (!caseData.contactEmail) {
    return { hasContactEmail: false, changed: false }
  }

  await caseRef.update({
    contactEmail: admin.firestore.FieldValue.delete(),
    contactEmailAddedAt: admin.firestore.FieldValue.delete(),
    contactEmailLastTemplateId: admin.firestore.FieldValue.delete(),
    contactEmailLastSentAt: admin.firestore.FieldValue.delete(),
    contactEmailRemovedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  await appendSystemMessage(caseRef, SYSTEM_MESSAGES.contactEmailRemoved)
  await logTransition(firestore, { caseId, action: 'contact_email_removed' })

  return { hasContactEmail: false, changed: true }
})

exports.SYSTEM_MESSAGES = SYSTEM_MESSAGES
