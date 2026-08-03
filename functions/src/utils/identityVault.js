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

// Encrypts a reporter identity / burner email mapping / any other
// confidential-tier field before it's written to Firestore. Returns an
// envelope, never a bare string, because AES-GCM needs its IV and auth tag
// to decrypt later and those aren't secret - only the key is.
function encryptIdentity(value) {
  if (value === undefined || value === null || value === '') {
    throw new Error('encryptIdentity() requires a non-empty value')
  }
  const plaintext = typeof value === 'string' ? value : JSON.stringify(value)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
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

function decryptWithKey(envelope) {
  const { ciphertext, iv, authTag } = envelope || {}
  if (!ciphertext || !iv || !authTag) {
    throw new Error(
      'decryptIdentity() requires a { ciphertext, iv, authTag } envelope'
    )
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
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

async function writeAuditEntry(firestore, entry) {
  await firestore.collection(AUDIT_COLLECTION).add({
    ...entry,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Split-key access, by design: the AES key above lives only in Secret
// Manager and decrypts the bytes, but the bytes are never handed back on
// key possession alone. Every call must also carry `auth` - a Firebase
// Auth token verified against Firebase Auth's own signing keys, a trust
// root this module never touches and can't leak alongside the AES secret -
// proving the caller currently holds the `superAdmin` custom claim, plus a
// non-empty, logged `reason`. A compromised IDENTITY_VAULT_ENCRYPTION_KEY
// secret by itself therefore decrypts nothing: the caller still needs a
// live Super Admin session to get past the checks below. There is no
// "admin can decrypt anything" path - callers that don't pass `auth`,
// `reason`, and `caseId` don't get a decrypt, they get a logged denial.
async function decryptIdentity({ envelope, auth, reason, caseId, field, firestore }) {
  const db = firestore || admin.firestore()
  const actorUid = auth?.uid ?? null
  const actorEmail = auth?.token?.email ?? null
  const actorRole = auth?.token?.role ?? null

  const deny = async (code, message) => {
    await writeAuditEntry(db, {
      actorUid,
      actorEmail,
      caseId: caseId ?? null,
      field: field ?? null,
      reason: reason ?? null,
      outcome: 'denied',
      detail: message,
    })
    throw new HttpsError(code, message)
  }

  if (!auth || !actorUid) {
    return deny('unauthenticated', 'Sign in as a Super Admin to decrypt identity data')
  }
  if (actorRole !== 'superAdmin') {
    return deny('permission-denied', 'Only a Super Admin may decrypt identity data')
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
      actorUid,
      actorEmail,
      caseId,
      field: field ?? null,
      reason,
      outcome: 'failed',
      detail: err.message,
    })
    throw new HttpsError('internal', 'Failed to decrypt identity data')
  }

  await writeAuditEntry(db, {
    actorUid,
    actorEmail,
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
}
