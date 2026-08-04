const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { createPulseInvite } = require('./pulseInvites')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const EMPLOYEES_SUBCOLLECTION = 'employees'
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

// Employees with no contact info on file are still real people on the roster,
// so their invite is queued like everyone else's and flagged for the delivery
// side to hold rather than dropped here. Skipping them would make the roster
// and the queue disagree about who was invited, and a Company Admin filling in
// an address later would have no way to tell which checks were never sent.
const PENDING_STATUS = 'pending'
const AWAITING_CONTACT_STATUS = 'awaiting_contact_info'

// Runs daily; for each company whose configured cadence has elapsed since
// its last send, queues a pulse-check invite notification per employee.
// The audience is companies/{companyId}/employees - the Company Admin's
// pulse-check roster (src/pages/company-admin/EmployeesPage.jsx), NOT the
// staff subcollection: staff are login-having accounts with roles, employees
// are people who receive pulse checks and have no account at all, and the
// two lists overlap only by coincidence. This used to fall back to the staff
// roster because no employee directory existed. Actual delivery (email/push)
// is left to the notifications module, same "queue metadata, deliver
// elsewhere" pattern as checkOverdueDeadlines.js.
exports.schedulePulseChecks = onSchedule('every day 01:00', async () => {
  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()

  for (const companyDoc of companiesSnapshot.docs) {
    const company = companyDoc.data()
    const cadenceDays = CADENCE_DAYS[company.pulseCheckCadence]
    if (!cadenceDays || !isDue(company, cadenceDays)) continue

    try {
      const employeesSnapshot = await companyDoc.ref.collection(EMPLOYEES_SUBCOLLECTION).get()
      if (employeesSnapshot.empty) {
        // Nothing to send to. Leave lastPulseCheckSentAt alone so the company
        // becomes due again immediately once a roster is imported, instead of
        // waiting out another full cadence for a send that never happened.
        logger.info('schedulePulseChecks: no employees on roster, skipping', { companyId: companyDoc.id })
        continue
      }

      const batch = firestore.batch()

      for (const employeeDoc of employeesSnapshot.docs) {
        const employee = employeeDoc.data()
        if (employee.status === 'inactive') continue

        const email = employee.email || null
        // Each queued invite carries its own single-use token. The plaintext
        // token is returned here exactly once and lives only on the queued
        // notification (a Cloud-Functions-only collection), for the delivery
        // side to build the employee's link from; only its salted hash is
        // persisted on pulseInvites. expiresAt is now + this cadence, so the
        // invite dies when the next send is due - one live invite per employee.
        const { inviteId, token } = await createPulseInvite(firestore, {
          companyId: companyDoc.id,
          employeeId: employeeDoc.id,
          department: employee.department ?? null,
          cadenceDays,
        })

        const notificationRef = firestore.collection(NOTIFICATIONS_COLLECTION).doc()
        batch.set(notificationRef, {
          type: 'pulseCheckInvite',
          audience: 'employee',
          companyId: companyDoc.id,
          employeeId: employeeDoc.id,
          department: employee.department ?? null,
          recipientEmail: email,
          inviteId,
          inviteToken: token,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: email ? PENDING_STATUS : AWAITING_CONTACT_STATUS,
        })
      }

      batch.update(companyDoc.ref, { lastPulseCheckSentAt: admin.firestore.FieldValue.serverTimestamp() })
      await batch.commit()
    } catch (err) {
      logger.error('schedulePulseChecks: failed to queue invites', { companyId: companyDoc.id, error: err.message })
    }
  }
})
