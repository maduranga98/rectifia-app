const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret, defineInt } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid } = require('../utils/staffAuth')
const { encryptionKeySecret, rotateEnvelopeKey } = require('../utils/identityVault')
const { recordControlRun } = require('./controlRunLog')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const SUPER_ADMINS_COLLECTION = 'superAdmins'
const KEY_ROTATION_STATE_COLLECTION = 'keyRotationState'
const KEY_ROTATION_LOG_COLLECTION = 'keyRotationLog'
const NOTIFICATIONS_COLLECTION = 'notifications'
const CONTROL_NAME = 'keyRotation'

const DAY_MS = 24 * 60 * 60 * 1000
const rotationAlertDays = defineInt('KEY_ROTATION_ALERT_DAYS', { default: 365 })
// Once a key is over-threshold, don't re-send the same alert every week -
// re-alert monthly so a Super Admin who is slow to act is reminded, without
// a mailbox getting one of these every single scheduled run.
const REALERT_COOLDOWN_DAYS = 30

// The secret material this app actually holds and can therefore track the
// age of. Nothing here can see Secret Manager's own rotation metadata (that
// would need a separate IAM grant this app doesn't have), so "age" is tracked
// from the last time a human told this module a rotation happened - see
// recordKeyRotation below - not from anything Secret Manager reports itself.
const TRACKED_KEYS = [
  {
    keyId: 'IDENTITY_VAULT_ENCRYPTION_KEY',
    label: 'Identity vault encryption key (AES-256-GCM)',
  },
  { keyId: 'VAPID_KEYS', label: 'Web push VAPID key pair' },
  { keyId: 'ANTHROPIC_API_KEY', label: 'Anthropic API key' },
]

// The previous identity vault key, kept configured only for the duration of a
// rotation window: an operator rotates IDENTITY_VAULT_ENCRYPTION_KEY in
// Secret Manager, moves its old value here, deploys, then runs
// rotateIdentityVaultKey below until it reports done:true, and only then
// removes this secret. Both keys must be live at once for exactly the reason
// documented on rotateEnvelopeKey in identityVault.js.
const previousEncryptionKeySecret = defineSecret('IDENTITY_VAULT_ENCRYPTION_KEY_PREVIOUS')

async function isSuperAdmin(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

async function appendKeyRotationLog(firestore, entry) {
  await firestore.collection(KEY_ROTATION_LOG_COLLECTION).add({
    ...entry,
    at: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Runs weekly. For each tracked key, reads (or seeds, on first run) its
// rotation state and compares age against the configured threshold. Never
// rotates or revokes anything - it only alerts, and only re-alerts on a
// cooldown so the same overdue key doesn't generate a fresh page every week.
exports.keyRotationCheck = onSchedule('every monday 06:00', async () => {
  const firestore = admin.firestore()
  const threshold = rotationAlertDays.value()
  const now = Date.now()

  let overThresholdCount = 0
  let alertsSent = 0

  for (const { keyId, label } of TRACKED_KEYS) {
    try {
      const stateRef = firestore.collection(KEY_ROTATION_STATE_COLLECTION).doc(keyId)
      // eslint-disable-next-line no-await-in-loop
      const stateSnap = await stateRef.get()
      let rotatedAtMs = toMillis(stateSnap.data()?.rotatedAt)
      let alertedAtMs = toMillis(stateSnap.data()?.alertedAt)

      if (!stateSnap.exists || rotatedAtMs === null) {
        // First run for this key, or a state doc that predates this control -
        // seed the clock from now rather than assuming an unknown age. This
        // undercounts the true key age on the very first run only; an
        // operator who knows the real rotation date should call
        // recordKeyRotation once to correct it.
        rotatedAtMs = now
        alertedAtMs = null
        // eslint-disable-next-line no-await-in-loop
        await stateRef.set({
          keyId,
          label,
          rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
          rotatedByUid: null,
          alertedAt: null,
          thresholdDays: threshold,
          lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
          ageDays: 0,
        }, { merge: true })
        // eslint-disable-next-line no-await-in-loop
        await appendKeyRotationLog(firestore, { keyId, event: 'seeded', ageDays: 0, thresholdDays: threshold })
        continue
      }

      const ageDays = Math.floor((now - rotatedAtMs) / DAY_MS)
      const overThreshold = ageDays > threshold
      if (overThreshold) overThresholdCount += 1

      const cooldownElapsed = alertedAtMs === null || now - alertedAtMs > REALERT_COOLDOWN_DAYS * DAY_MS

      // eslint-disable-next-line no-await-in-loop
      await stateRef.update({
        lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        ageDays,
        thresholdDays: threshold,
        ...(overThreshold && cooldownElapsed ? { alertedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
      })

      // eslint-disable-next-line no-await-in-loop
      await appendKeyRotationLog(firestore, { keyId, event: 'check', ageDays, thresholdDays: threshold, overThreshold })

      if (overThreshold && cooldownElapsed) {
        alertsSent += 1
        // eslint-disable-next-line no-await-in-loop
        await firestore.collection(NOTIFICATIONS_COLLECTION).add({
          type: 'keyRotationDue',
          keyId,
          ageDays,
          thresholdDays: threshold,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
        })
      }
    } catch (err) {
      logger.error('keyRotationCheck: key check failed', { keyId, error: err.message })
    }
  }

  await recordControlRun(firestore, {
    control: CONTROL_NAME,
    outcome: 'ok',
    summary: { keysTracked: TRACKED_KEYS.length, overThresholdCount, alertsSent, thresholdDays: threshold },
  })
})

// Records that a Super Admin actually rotated a key's value in Secret
// Manager - this app has no API access to Secret Manager's own rotation
// history, so this callable is the only way that fact enters the system.
// Resets the tracked age to zero and clears any pending alert.
exports.recordKeyRotation = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { keyId, note } = request.data || {}
  const firestore = admin.firestore()

  if (!(await isSuperAdmin(firestore, uid))) {
    throw new HttpsError('permission-denied', 'Only a Super Admin may record a key rotation')
  }
  const tracked = TRACKED_KEYS.find((k) => k.keyId === keyId)
  if (!tracked) {
    throw new HttpsError('invalid-argument', `Unknown keyId. Expected one of: ${TRACKED_KEYS.map((k) => k.keyId).join(', ')}`)
  }

  await firestore.collection(KEY_ROTATION_STATE_COLLECTION).doc(keyId).set(
    {
      keyId,
      label: tracked.label,
      rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
      rotatedByUid: uid,
      alertedAt: null,
      ageDays: 0,
    },
    { merge: true }
  )
  await appendKeyRotationLog(firestore, {
    keyId,
    event: 'rotated',
    actorUid: uid,
    note: typeof note === 'string' ? note.slice(0, 500) : null,
  })

  return { keyId, rotated: true }
})

// The batch of confidential-tier + contact-email-bearing cases this
// invocation scanned and, where a vault envelope was found, re-encrypted -
// keyed by document id so a caller can resume with the returned cursor.
async function processVaultRotationBatch(firestore, { cursor, limit, oldKeyHex, newKeyHex, uid }) {
  let query = firestore.collection(CASES_COLLECTION).orderBy(admin.firestore.FieldPath.documentId()).limit(limit)
  if (cursor) {
    query = query.startAfter(cursor)
  }
  const snapshot = await query.get()

  let migratedFields = 0
  for (const doc of snapshot.docs) {
    const caseData = doc.data()
    const update = {}

    for (const field of ['reporterIdentity', 'contactEmail']) {
      const envelope = caseData[field]?.vault
      if (!envelope) continue
      try {
        // eslint-disable-next-line no-await-in-loop
        const rotated = rotateEnvelopeKey(envelope, { oldKeyHex, newKeyHex })
        update[`${field}.vault`] = rotated
        migratedFields += 1
        // eslint-disable-next-line no-await-in-loop
        await appendKeyRotationLog(firestore, {
          keyId: 'IDENTITY_VAULT_ENCRYPTION_KEY',
          event: 'vault_reencrypt',
          actorUid: uid,
          caseId: doc.id,
          field,
          outcome: 'granted',
        })
      } catch (err) {
        // eslint-disable-next-line no-await-in-loop
        await appendKeyRotationLog(firestore, {
          keyId: 'IDENTITY_VAULT_ENCRYPTION_KEY',
          event: 'vault_reencrypt',
          actorUid: uid,
          caseId: doc.id,
          field,
          outcome: 'failed',
          detail: err.message,
        })
        logger.error('rotateIdentityVaultKey: re-encrypt failed, record left on old key', {
          caseId: doc.id,
          field,
          error: err.message,
        })
      }
    }

    if (Object.keys(update).length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await doc.ref.update(update)
    }
  }

  const last = snapshot.docs[snapshot.docs.length - 1]
  return {
    processed: snapshot.docs.length,
    migratedFields,
    nextCursor: last ? last.id : null,
    done: snapshot.docs.length < limit,
  }
}

// The documented re-encryption path for the identity vault. Super Admin only,
// and requires BOTH the outgoing key (IDENTITY_VAULT_ENCRYPTION_KEY_PREVIOUS,
// set by the operator during the rotation window - see the secret's own
// comment above) and the incoming one (IDENTITY_VAULT_ENCRYPTION_KEY, already
// rotated in Secret Manager and redeployed) to be configured.
//
// Processes one bounded page of cases per call - never the whole vault in one
// invocation - and returns a cursor so the operator (or SecurityDashboard,
// which calls this in a loop) can resume. Every re-encrypted field is logged
// individually to keyRotationLog; this function itself never returns,
// stores, or logs a plaintext value - rotateEnvelopeKey in identityVault.js
// decrypts-with-old and encrypts-with-new internally and hands back ciphertext
// only.
exports.rotateIdentityVaultKey = onCall(
  { secrets: [encryptionKeySecret, previousEncryptionKeySecret] },
  async (request) => {
    const uid = requireAuthUid(request)
    const firestore = admin.firestore()

    if (!(await isSuperAdmin(firestore, uid))) {
      throw new HttpsError('permission-denied', 'Only a Super Admin may run the vault re-encryption migration')
    }

    const oldKeyHex = previousEncryptionKeySecret.value()
    const newKeyHex = encryptionKeySecret.value()
    if (!oldKeyHex) {
      throw new HttpsError(
        'failed-precondition',
        'IDENTITY_VAULT_ENCRYPTION_KEY_PREVIOUS is not configured. Set it to the outgoing key before starting a rotation.'
      )
    }

    const { cursor = null, limit: rawLimit } = request.data || {}
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 300) : 200

    const result = await processVaultRotationBatch(firestore, { cursor, limit, oldKeyHex, newKeyHex, uid })

    if (result.done) {
      await recordControlRun(firestore, {
        control: CONTROL_NAME,
        outcome: 'ok',
        summary: { event: 'vault_rotation_batch_complete', actorUid: uid },
      })
    }

    return result
  }
)

exports.TRACKED_KEYS = TRACKED_KEYS
exports.KEY_ROTATION_STATE_COLLECTION = KEY_ROTATION_STATE_COLLECTION
exports.KEY_ROTATION_LOG_COLLECTION = KEY_ROTATION_LOG_COLLECTION
