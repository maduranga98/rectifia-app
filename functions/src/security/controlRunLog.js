const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Module 26's shared "the control ran" record, written by every scheduled
// control in this directory (accessReview, keyRotation, anomalyDetection,
// integrityCheck, backupVerification) at the end of every run - including a
// run that finds nothing to flag. "No exceptions found" and "this job hasn't
// run in six months" are indistinguishable to an auditor unless the absence
// of findings is itself a written record, so every control writes here
// unconditionally rather than only when it has something to report.
//
// This is deliberately a SEPARATE collection from each control's own
// findings collection (accessReviews, keyRotationLog, securityAlerts,
// integrityFindings, backupVerifications) rather than inferring "did it run"
// from the presence of rows there - a control that ran and found zero issues
// writes zero rows to its findings collection, and this is what tells the
// difference between that and a control that silently stopped running apart
// from those rows. It is also the one place src/pages/superadmin/
// SecurityDashboard.jsx reads to show "last run" for every control on one
// screen, rather than five different queries with five different shapes.
const CONTROL_RUNS_COLLECTION = 'securityControlRuns'

// `summary` is a small object of counts/labels (e.g. { period, dormantCount })
// - never case content, never identity, never a narrative. Same metadata-only
// discipline as every other audit log in this app.
async function recordControlRun(firestore, { control, outcome, summary, detail }) {
  await firestore.collection(CONTROL_RUNS_COLLECTION).add({
    control,
    outcome: outcome ?? 'ok',
    summary: summary ?? {},
    detail: detail ?? null,
    ranAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

module.exports = { recordControlRun, CONTROL_RUNS_COLLECTION }
