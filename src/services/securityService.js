import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// Module 26's client boundary. Every collection this reads from
// (securityAlerts, accessReviews, keyRotationLog/keyRotationState,
// integrityFindings, backupVerifications, securityControlRuns,
// privilegedActionLog) is Admin-SDK-write-only and sealed to direct client
// reads in firestore.rules - getSecurityDashboard is the one path any of it
// reaches the browser through. Keep this service as the only import site for
// module 26 data, the same convention benchmarkService.js and
// retentionService.js already follow for their own sealed collections.
const getSecurityDashboardCallable = httpsCallable(functions, 'getSecurityDashboard')
const attestAccessReviewCallable = httpsCallable(functions, 'attestAccessReview')
const getAccessReviewForAttestationCallable = httpsCallable(functions, 'getAccessReviewForAttestation')
const recordKeyRotationCallable = httpsCallable(functions, 'recordKeyRotation')
const reviewSecurityAlertCallable = httpsCallable(functions, 'reviewSecurityAlert')
const attestRestoreTestCallable = httpsCallable(functions, 'attestRestoreTest')

export async function getSecurityDashboard() {
  const result = await getSecurityDashboardCallable({})
  return result.data
}

export async function getAccessReviewForAttestation(reviewId) {
  const result = await getAccessReviewForAttestationCallable({ reviewId })
  return result.data
}

export async function attestAccessReview(reviewId, decisions) {
  const result = await attestAccessReviewCallable({ reviewId, decisions })
  return result.data
}

export async function recordKeyRotation(keyId, note) {
  const result = await recordKeyRotationCallable({ keyId, note })
  return result.data
}

export async function reviewSecurityAlert(alertId, note) {
  const result = await reviewSecurityAlertCallable({ alertId, note })
  return result.data
}

export async function attestRestoreTest(outcome, notes) {
  const result = await attestRestoreTestCallable({ outcome, notes })
  return result.data
}

export const ALERT_SEVERITY_TONE = {
  high: 'tone-critical',
  medium: 'tone-high',
  low: 'tone-info',
}

export const ALERT_TYPE_LABELS = {
  identity_decrypt_above_baseline: 'Identity decryptions above baseline',
  bulk_evidence_download: 'Bulk evidence download',
  report_export_above_baseline: 'Report exports above baseline',
  off_hours_access: 'Access outside working hours',
  unusual_department_spread: 'Unusual department spread',
  backup_export_stale_or_missing: 'Backup export stale or missing',
  restore_test_overdue: 'Restore test overdue',
}
