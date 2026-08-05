const crypto = require('crypto')
const { defineSecret } = require('firebase-functions/params')
const { HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Secret Manager-backed AES key. Any Cloud Function that calls
// encryptIdentity/decryptIdentity must list this in its own `secrets: [...]`
// option (see functions/src/intake/aiFollowUp.js for the same pattern with
// ANTHROPIC_API_KEY) - it is never read from a plain process.env var.
const encryptionKeySecret = defineSecret('IDENTITY_VAULT_ENCRYPTION_KEY')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUDIT_COLLECTION = 'identityAccessAuditLog'
const MIN_REASON_LENGTH = 10

function getKey() {
  const raw = encryptionKeySecret.value()
  if (!raw) {
    throw new Error('IDENTITY_VAULT_ENCRYPTION_KEY secret is not configured')
  }
  const key = Buffer.from(raw, 'hex')
  if (key.length !== 32) {
    throw new Error(
      'IDENTITY_VAULT_ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 characters)'
    )
  }
  return key
}

// The parameterised core of encryptIdentity/decryptWithKey, taking an
// explicit key buffer rather than reading getKey() itself. Everything below
// this line is a thin wrapper over these two - encryptIdentity/decryptWithKey
// bind them to the live Secret Manager key, and rotateEnvelopeKey (module 26)
// is the one caller that legitimately needs to name two different keys in the
// same operation.
function encryptWithKey(value, key) {
  if (value === undefined || value === null || value === '') {
    throw new Error('encryptWithKey() requires a non-empty value')
  }
  const plaintext = typeof value === 'string' ? value : JSON.stringify(value)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

function decryptWithKeyBuffer(envelope, key) {
  const { ciphertext, iv, authTag } = envelope || {}
  if (!ciphertext || !iv || !authTag) {
    throw new Error(
      'decryptIdentity() requires a { ciphertext, iv, authTag } envelope'
    )
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(authTag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
  try {
    return JSON.parse(plaintext)
  } catch {
    return plaintext
  }
}

// Encrypts a reporter identity / burner email mapping / any other
// confidential-tier field before it's written to Firestore. Returns an
// envelope, never a bare string, because AES-GCM needs its IV and auth tag
// to decrypt later and those aren't secret - only the key is.
function encryptIdentity(value) {
  return encryptWithKey(value, getKey())
}

function decryptWithKey(envelope) {
  return decryptWithKeyBuffer(envelope, getKey())
}

// Module 26's key-rotation primitive. Re-encrypts one vault envelope under a
// new key without ever handing plaintext back to the caller - the migration
// in functions/src/security/keyRotation.js never sees a reporter identity, it
// only ever sees ciphertext going in and ciphertext coming out. That is what
// makes "per record, fully logged, never a bulk plaintext dump" a property of
// this module rather than a discipline the caller has to maintain itself.
//
// Takes raw hex key material for both keys rather than reading defineSecret()
// itself: a rotation run needs the OUTGOING key (to decrypt what is currently
// stored) and the INCOMING key (to re-encrypt it) at the same time, which no
// single `secrets: [...]` declaration on this module can express - the
// caller declares both secrets and resolves the hex values itself.
function rotateEnvelopeKey(envelope, { oldKeyHex, newKeyHex }) {
  const oldKey = Buffer.from(String(oldKeyHex ?? ''), 'hex')
  const newKey = Buffer.from(String(newKeyHex ?? ''), 'hex')
  if (oldKey.length !== 32 || newKey.length !== 32) {
    throw new Error('rotateEnvelopeKey() requires two 32-byte, hex-encoded keys')
  }
  const plaintext = decryptWithKeyBuffer(envelope, oldKey)
  return encryptWithKey(plaintext, newKey)
}

// The one writer for identityAccessAuditLog. Exported (as
// writeIdentityAuditEntry) because decryption is no longer the only event that
// belongs in this log: a reporter choosing to identify themselves mid-case, or
// adding/removing a contact address, changes what the vault holds without ever
// decrypting it (functions/src/intake/identityTransition.js). Those events are
// exactly as accountable as a read, and splitting them into a second
// collection would mean an auditor had to join two logs to answer "what has
// ever happened to this case's identity data".
//
// Every entry carries an `action`, so a staff decrypt ('staff_reveal') is
// never confusable with a reporter's own disclosure ('reporter_self_reveal') -
// the two look nothing alike in accountability terms and must not read alike
// in the log.
async function writeAuditEntry(firestore, entry) {
  await firestore.collection(AUDIT_COLLECTION).add({
    ...entry,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Split-key access, by design: the AES key above lives only in Secret
// Manager and decrypts the bytes, but the bytes are never handed back on
// key possession alone. A compromised IDENTITY_VAULT_ENCRYPTION_KEY secret
// by itself therefore decrypts nothing.
//
// This module is deliberately policy-FREE about *who* may decrypt. It does
// not know the role vocabulary and does not decide authorization - the call
// site does that and hands in an already-resolved `authorizedAs` string
// (e.g. 'assignedHandler', 'superAdmin') describing the grant it permitted.
// The vault's job is narrower and unchanging: refuse without an authorization
// result, a documented `reason` of at least MIN_REASON_LENGTH, and a
// `caseId`; record who/when/case/reason/authorizedAs on every attempt,
// granted or denied; and never return the value on anything less. That keeps
// the one place policy could drift - "which roles count" - out in the
// callables (see functions/src/investigation/revealIdentity.js), each of
// which is explicit about who it let through and why.
//
// The earlier hardcoded `auth.token.role === 'superAdmin'` check lived here
// and could never pass: Super Admin is superAdmins/{uid} allowlist
// membership, not a custom claim (see src/constants/roles.js), so it gated
// out everyone. Resolving authorization at the call site fixes that and lets
// the assigned investigator reveal identity on their own case (Blueprint
// §7.1) without this module having to learn either rule.
async function decryptIdentity({
  envelope,
  authorizedAs,
  actorUid,
  actorEmail,
  reason,
  caseId,
  field,
  firestore,
  // What kind of access this is, recorded on every audit entry below.
  // Defaults to a staff-initiated reveal because that is what every human
  // caller of this function is; automated deliveries pass their own label
  // (see functions/src/notifications/sendContactEmailUpdate.js).
  action = 'staff_reveal',
}) {
  const db = firestore || admin.firestore()
  const uid = actorUid ?? null
  const email = actorEmail ?? null

  const deny = async (code, message) => {
    await writeAuditEntry(db, {
      action,
      actorUid: uid,
      actorEmail: email,
      authorizedAs: authorizedAs ?? null,
      caseId: caseId ?? null,
      field: field ?? null,
      reason: reason ?? null,
      outcome: 'denied',
      detail: message,
    })
    throw new HttpsError(code, message)
  }

  // Defensive: a caller that resolved no authorization must not reach a
  // decrypt. Real callers throw before getting here, so this only catches a
  // programming error - and logs it as the denial it is.
  if (!authorizedAs) {
    return deny('permission-denied', 'No authorization was established to decrypt identity data')
  }
  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    return deny(
      'invalid-argument',
      `A documented legal reason of at least ${MIN_REASON_LENGTH} characters is required to decrypt identity data`
    )
  }
  if (!caseId) {
    return deny('invalid-argument', 'caseId is required to decrypt identity data')
  }

  let plaintext
  try {
    plaintext = decryptWithKey(envelope)
  } catch (err) {
    await writeAuditEntry(db, {
      action,
      actorUid: uid,
      actorEmail: email,
      authorizedAs,
      caseId,
      field: field ?? null,
      reason,
      outcome: 'failed',
      detail: err.message,
    })
    throw new HttpsError('internal', 'Failed to decrypt identity data')
  }

  await writeAuditEntry(db, {
    action,
    actorUid: uid,
    actorEmail: email,
    authorizedAs,
    caseId,
    field: field ?? null,
    reason,
    outcome: 'granted',
  })

  return plaintext
}

module.exports = {
  encryptionKeySecret,
  encryptIdentity,
  decryptIdentity,
  rotateEnvelopeKey,
  writeIdentityAuditEntry: writeAuditEntry,
  AUDIT_COLLECTION,
  MIN_REASON_LENGTH,
}
