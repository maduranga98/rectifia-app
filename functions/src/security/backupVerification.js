const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineString, defineInt } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid } = require('../utils/staffAuth')
const { recordControlRun } = require('./controlRunLog')
const { writeSecurityAlert } = require('./securityAlerts')

if (!admin.apps.length) {
  admin.initializeApp()
}

const SUPER_ADMINS_COLLECTION = 'superAdmins'
const BACKUP_VERIFICATIONS_COLLECTION = 'backupVerifications'
const CONTROL_NAME = 'backupVerification'
const DAY_MS = 24 * 60 * 60 * 1000

// The GCS bucket Firestore's scheduled export job (configured separately, in
// Cloud Scheduler + `gcloud firestore export`, or the Firestore console's
// managed Backups feature - this app has no code path that triggers an
// export itself, only one that checks the results) writes daily/weekly
// exports into. A managed export writes an object named exactly
// `<timestamp>.overall_export_metadata` at the root of each export folder;
// finding one, and being able to read its bytes, is what "actually ran and
// is readable" means below - a folder that exists but errors on read is
// exactly the failure mode a bucket-listing-only check would miss.
const exportBucketName = defineString('FIRESTORE_EXPORT_BUCKET', { default: '' })
const exportMaxAgeDays = defineInt('FIRESTORE_EXPORT_MAX_AGE_DAYS', { default: 35 })
// How long a restore test may go unattested before it is itself flagged. A
// backup nobody has test-restored in this long is not a verified backup,
// regardless of how fresh the last export was.
const RESTORE_TEST_MAX_AGE_DAYS = 180

function currentPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

async function isSuperAdmin(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

// Finds the most recent export metadata object under the bucket and confirms
// its bytes are actually readable (a HEAD-then-download, not just a list -
// see the comment on exportBucketName above for why a listing alone is not
// enough). Returns { found, readable, exportedAt, objectName } - every field
// null/false if the bucket isn't configured or nothing was found, never a
// thrown error, so the scheduled run can always still write a control record.
async function findLatestExport() {
  const bucketName = exportBucketName.value()
  if (!bucketName) {
    return { found: false, readable: false, exportedAt: null, objectName: null, reason: 'bucket_not_configured' }
  }

  const bucket = admin.storage().bucket(bucketName)
  const [files] = await bucket.getFiles({ suffix: '.overall_export_metadata' })
  if (files.length === 0) {
    return { found: false, readable: false, exportedAt: null, objectName: null, reason: 'no_export_found' }
  }

  // Metadata object names are timestamp-prefixed, so the lexicographically
  // last one is also the most recent.
  const latest = files.sort((a, b) => (a.name < b.name ? 1 : -1))[0]

  let readable = false
  try {
    const [metadata] = await latest.getMetadata()
    // A real read of the bytes, not just a metadata HEAD - the smallest
    // possible proof this object isn't a zero-byte or access-denied stub.
    await latest.download()
    readable = true
    return {
      found: true,
      readable,
      exportedAt: metadata.timeCreated ? new Date(metadata.timeCreated).getTime() : null,
      objectName: latest.name,
      reason: null,
    }
  } catch (err) {
    logger.error('backupVerification: export object not readable', { objectName: latest.name, error: err.message })
    return { found: true, readable: false, exportedAt: null, objectName: latest.name, reason: err.message }
  }
}

// Runs monthly. Confirms the most recent scheduled Firestore export exists
// and is readable, carries forward whatever restore-test attestation is on
// file (this control cannot perform a live restore itself - see
// attestRestoreTest below), and always writes a backupVerifications document
// for the period, whether or not anything is wrong.
exports.backupVerification = onSchedule('0 7 1 * *', async () => {
  const firestore = admin.firestore()
  const period = currentPeriod()

  const exportResult = await findLatestExport().catch((err) => {
    logger.error('backupVerification: export check threw', { error: err.message })
    return { found: false, readable: false, exportedAt: null, objectName: null, reason: err.message }
  })

  const now = Date.now()
  const exportStale =
    !exportResult.found || exportResult.exportedAt === null || now - exportResult.exportedAt > exportMaxAgeDays.value() * DAY_MS

  // Carry forward the previous period's restore-test attestation - a backup
  // that was restore-tested two months ago doesn't need a fresh attestation
  // every single month, only within RESTORE_TEST_MAX_AGE_DAYS.
  const previous = await firestore
    .collection(BACKUP_VERIFICATIONS_COLLECTION)
    .orderBy('period', 'desc')
    .limit(1)
    .get()
  const priorAttestation = previous.empty ? null : previous.docs[0].data().restoreTestAttestation ?? null

  const lastRestoreTestAt = priorAttestation?.attestedAt ? priorAttestation.attestedAt.toMillis?.() ?? null : null
  const restoreTestOverdue = lastRestoreTestAt === null || now - lastRestoreTestAt > RESTORE_TEST_MAX_AGE_DAYS * DAY_MS

  await firestore
    .collection(BACKUP_VERIFICATIONS_COLLECTION)
    .doc(period)
    .set({
      period,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
      exportFound: exportResult.found,
      exportReadable: exportResult.readable,
      exportObjectName: exportResult.objectName,
      exportedAt: exportResult.exportedAt ? admin.firestore.Timestamp.fromMillis(exportResult.exportedAt) : null,
      exportStale,
      restoreTestAttestation: priorAttestation,
      restoreTestOverdue,
    })

  if (exportStale) {
    await writeSecurityAlert(firestore, {
      type: 'backup_export_stale_or_missing',
      severity: 'high',
      summary: exportResult.found
        ? `Latest Firestore export is older than ${exportMaxAgeDays.value()} days or unreadable`
        : 'No Firestore export found in the configured backup bucket',
      metric: { exportFound: exportResult.found, exportReadable: exportResult.readable, reason: exportResult.reason },
    })
  }
  if (restoreTestOverdue) {
    await writeSecurityAlert(firestore, {
      type: 'restore_test_overdue',
      severity: 'medium',
      summary: `No attested restore test in the last ${RESTORE_TEST_MAX_AGE_DAYS} days`,
      metric: { lastRestoreTestAt },
    })
  }

  await recordControlRun(firestore, {
    control: CONTROL_NAME,
    outcome: exportStale ? 'attention_needed' : 'ok',
    summary: { period, exportFound: exportResult.found, exportReadable: exportResult.readable, exportStale, restoreTestOverdue },
  })
})

// The attestation field an operator must complete: a Super Admin who has
// actually performed a restore-from-backup drill records the outcome here.
// This control can confirm an export EXISTS and is readable; it cannot prove
// the data in it can be turned back into a working database, because doing
// that automatically would mean spinning up a second Firestore-like
// environment and importing real case data into it on a schedule - well
// outside what a background job should be trusted to do unattended. A backup
// never test-restored is not a verified backup, so this field being null is
// itself the finding restoreTestOverdue above surfaces.
exports.attestRestoreTest = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { outcome, notes } = request.data || {}
  const firestore = admin.firestore()

  if (!(await isSuperAdmin(firestore, uid))) {
    throw new HttpsError('permission-denied', 'Only a Super Admin may attest a restore test')
  }
  if (outcome !== 'passed' && outcome !== 'failed') {
    throw new HttpsError('invalid-argument', 'outcome must be "passed" or "failed"')
  }

  const period = currentPeriod()
  const attestation = {
    attestedByUid: uid,
    attestedAt: admin.firestore.FieldValue.serverTimestamp(),
    outcome,
    notes: typeof notes === 'string' ? notes.slice(0, 1000) : null,
  }

  await firestore
    .collection(BACKUP_VERIFICATIONS_COLLECTION)
    .doc(period)
    .set(
      { period, restoreTestAttestation: attestation, restoreTestOverdue: outcome !== 'passed' },
      { merge: true }
    )

  return { status: 'recorded', outcome }
})

exports.BACKUP_VERIFICATIONS_COLLECTION = BACKUP_VERIFICATIONS_COLLECTION
