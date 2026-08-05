const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid } = require('../utils/staffAuth')
const { SECURITY_ALERTS_COLLECTION } = require('./securityAlerts')
const { ACCESS_REVIEWS_COLLECTION } = require('./accessReview')
const { KEY_ROTATION_STATE_COLLECTION, TRACKED_KEYS } = require('./keyRotation')
const { BACKUP_VERIFICATIONS_COLLECTION } = require('./backupVerification')
const { CONTROL_RUNS_COLLECTION } = require('./controlRunLog')

if (!admin.apps.length) {
  admin.initializeApp()
}

const SUPER_ADMINS_COLLECTION = 'superAdmins'
const OPEN_ALERTS_LIMIT = 100
const PENDING_REVIEWS_LIMIT = 50
const CONTROL_RUN_SCAN_LIMIT = 200

async function isSuperAdmin(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

// Reduces a page of securityControlRuns (newest first) down to one row per
// control - the run record scheme is append-only (see controlRunLog.js), so
// "the latest run of each control" has to be derived here rather than read
// directly. CONTROL_RUN_SCAN_LIMIT is generous enough to cover every
// control's cadence at least once even if one control has been running
// hourly-equivalent for a while; a control genuinely missing from the scanned
// page surfaces as "no run recorded" on the dashboard, which is itself a
// finding worth showing rather than hiding behind a wider, slower query.
function latestRunPerControl(docs) {
  const byControl = new Map()
  for (const doc of docs) {
    const data = doc.data()
    if (!byControl.has(data.control)) {
      byControl.set(data.control, {
        control: data.control,
        outcome: data.outcome ?? null,
        summary: data.summary ?? null,
        ranAt: toMillis(data.ranAt),
      })
    }
  }
  return [...byControl.values()]
}

// The single read path for src/pages/superadmin/SecurityDashboard.jsx - every
// collection this module writes to is Admin-SDK-write-only and denied to
// every client role in firestore.rules (see the module 26 block there), so
// this callable is the only way any of it reaches the browser. Super Admin
// only, and deliberately narrow: it returns counts, recent rows, and run
// metadata from control collections, never a caseId-to-content join and never
// anything from cases/, messages/, or a questionnaire response - the same
// no-case-content boundary every other module in this app holds, including
// for the platform operator role.
exports.getSecurityDashboard = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  if (!(await isSuperAdmin(firestore, uid))) {
    throw new HttpsError('permission-denied', 'Only a Super Admin may view the security dashboard')
  }

  const [openAlertsSnap, pendingReviewsSnap, keyStateSnap, latestBackupSnap, controlRunsSnap] = await Promise.all([
    firestore
      .collection(SECURITY_ALERTS_COLLECTION)
      .where('status', '==', 'open')
      .orderBy('detectedAt', 'desc')
      .limit(OPEN_ALERTS_LIMIT)
      .get(),
    firestore
      .collection(ACCESS_REVIEWS_COLLECTION)
      .where('status', '==', 'pending_attestation')
      .orderBy('generatedAt', 'desc')
      .limit(PENDING_REVIEWS_LIMIT)
      .get(),
    firestore.collection(KEY_ROTATION_STATE_COLLECTION).get(),
    firestore.collection(BACKUP_VERIFICATIONS_COLLECTION).orderBy('period', 'desc').limit(1).get(),
    firestore.collection(CONTROL_RUNS_COLLECTION).orderBy('ranAt', 'desc').limit(CONTROL_RUN_SCAN_LIMIT).get(),
  ])

  const openAlerts = openAlertsSnap.docs.map((d) => ({
    id: d.id,
    type: d.data().type ?? null,
    severity: d.data().severity ?? null,
    summary: d.data().summary ?? null,
    companyId: d.data().companyId ?? null,
    actorUid: d.data().actorUid ?? null,
    detectedAt: toMillis(d.data().detectedAt),
  }))

  const pendingAccessReviews = pendingReviewsSnap.docs.map((d) => ({
    reviewId: d.id,
    companyId: d.data().companyId ?? null,
    period: d.data().period ?? null,
    accountCount: d.data().accountCount ?? 0,
    dormantCount: d.data().dormantCount ?? 0,
    generatedAt: toMillis(d.data().generatedAt),
  }))

  const stateByKeyId = new Map(keyStateSnap.docs.map((d) => [d.id, d.data()]))
  const keyAges = TRACKED_KEYS.map(({ keyId, label }) => {
    const state = stateByKeyId.get(keyId)
    return {
      keyId,
      label,
      ageDays: state?.ageDays ?? null,
      thresholdDays: state?.thresholdDays ?? null,
      rotatedAt: toMillis(state?.rotatedAt),
      lastCheckedAt: toMillis(state?.lastCheckedAt),
      overThreshold:
        typeof state?.ageDays === 'number' && typeof state?.thresholdDays === 'number'
          ? state.ageDays > state.thresholdDays
          : null,
    }
  })

  const lastBackup = latestBackupSnap.empty
    ? null
    : (() => {
        const data = latestBackupSnap.docs[0].data()
        return {
          period: data.period ?? null,
          checkedAt: toMillis(data.checkedAt),
          exportFound: data.exportFound ?? null,
          exportReadable: data.exportReadable ?? null,
          exportStale: data.exportStale ?? null,
          exportedAt: toMillis(data.exportedAt),
          restoreTestOverdue: data.restoreTestOverdue ?? null,
          restoreTestAttestation: data.restoreTestAttestation
            ? {
                attestedByUid: data.restoreTestAttestation.attestedByUid ?? null,
                attestedAt: toMillis(data.restoreTestAttestation.attestedAt),
                outcome: data.restoreTestAttestation.outcome ?? null,
              }
            : null,
        }
      })()

  return {
    openAlertCount: openAlertsSnap.size,
    openAlerts,
    pendingAccessReviewCount: pendingReviewsSnap.size,
    pendingAccessReviews,
    keyAges,
    lastBackup,
    controlRuns: latestRunPerControl(controlRunsSnap.docs),
  }
})
