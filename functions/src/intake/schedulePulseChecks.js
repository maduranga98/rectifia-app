const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Cadence is a company setting (companies/{companyId}.pulseCheckCadence),
// configured by the Company Admin panel alongside jurisdictions/departments.
// Unset defaults to no pulse checks being scheduled, rather than guessing a
// cadence a company never opted into.
const CADENCE_DAYS = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
}

function isDue(company, cadenceDays) {
  const lastSentAt = company.lastPulseCheckSentAt
  if (!lastSentAt) return true
  const elapsedMs = Date.now() - lastSentAt.toMillis()
  return elapsedMs >= cadenceDays * 24 * 60 * 60 * 1000
}

// Runs daily; for each company whose configured cadence has elapsed since
// its last send, queues a pulse-check invite notification per employee.
// There's no separate employee directory in this codebase yet, so - same
// placeholder every other module here accepts - the company's staff roster
// stands in as the pulse-check audience until one exists. Actual delivery
// (email/push) is left to the notifications module, same "queue metadata,
// deliver elsewhere" pattern as checkOverdueDeadlines.js.
exports.schedulePulseChecks = onSchedule('every day 01:00', async () => {
  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()

  for (const companyDoc of companiesSnapshot.docs) {
    const company = companyDoc.data()
    const cadenceDays = CADENCE_DAYS[company.pulseCheckCadence]
    if (!cadenceDays || !isDue(company, cadenceDays)) continue

    try {
      const staffSnapshot = await companyDoc.ref.collection(STAFF_SUBCOLLECTION).get()
      const batch = firestore.batch()

      for (const staffDoc of staffSnapshot.docs) {
        const notificationRef = firestore.collection(NOTIFICATIONS_COLLECTION).doc()
        batch.set(notificationRef, {
          type: 'pulseCheckInvite',
          audience: 'employee',
          companyId: companyDoc.id,
          employeeId: staffDoc.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
        })
      }

      batch.update(companyDoc.ref, { lastPulseCheckSentAt: admin.firestore.FieldValue.serverTimestamp() })
      await batch.commit()
    } catch (err) {
      logger.error('schedulePulseChecks: failed to queue invites', { companyId: companyDoc.id, error: err.message })
    }
  }
})
