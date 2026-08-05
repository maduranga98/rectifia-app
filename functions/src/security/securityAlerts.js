const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Module 26's one shared findings surface for anything advisory: anomaly
// detection (functions/src/security/anomalyDetection.js) and backup
// verification (functions/src/security/backupVerification.js) both write
// here, so src/pages/superadmin/SecurityDashboard.jsx has a single "open
// alerts" query instead of one per control. Metadata only - a type, a
// severity, who/what it concerns, and a short summary string. Never case
// content, never a narrative, never identity.
//
// Advisory, unconditionally: nothing that writes here may also revoke
// access, delete data, or lock out a user as a side effect of the same call.
// A finding becomes a row a human reads, via reviewSecurityAlert
// (anomalyDetection.js) - never an automated consequence.
const SECURITY_ALERTS_COLLECTION = 'securityAlerts'

async function writeSecurityAlert(firestore, alert) {
  await firestore.collection(SECURITY_ALERTS_COLLECTION).add({
    ...alert,
    status: 'open',
    detectedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

module.exports = { writeSecurityAlert, SECURITY_ALERTS_COLLECTION }
