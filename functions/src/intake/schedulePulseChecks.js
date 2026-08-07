const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { createPulseInvite, PULSE_INVITES_COLLECTION } = require('./pulseInvites')
const { resolveFlag } = require('../utils/featureFlags')

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

// Raised when a company has no published question set. Both queueing paths - the
// daily scheduler and the on-demand send - refuse rather than sending invites
// nobody configured, and say so instead of appearing to work.
//
// A company with nothing published would still get a perfectly answerable
// core-only survey (resolveQuestionSet falls back to core), so this is not a
// technical necessity - it is a deliberate one. Publishing is the step where a
// named person signs off on what an entire workforce is about to be asked, and
// a company that has never taken that step should be told, once, rather than
// discovering months later that everyone was asked something nobody chose.
class NoPublishedQuestionSetError extends Error {
  constructor(companyId) {
    super('This company has no published pulse-check questionnaire')
    this.name = 'NoPublishedQuestionSetError'
    this.companyId = companyId
  }
}

// Writes the "we did not send" notification. Queued to the Company Admin, the
// one role that can fix it, and idempotent per company: a daily scheduler that
// wrote one of these every morning would be noise, not a signal, so an
// unacknowledged notice is left in place rather than duplicated.
async function notifyMissingQuestionSet(firestore, companyId) {
  const existing = await firestore
    .collection(NOTIFICATIONS_COLLECTION)
    .where('type', '==', 'pulseQuestionSetMissing')
    .where('companyId', '==', companyId)
    .where('status', '==', PENDING_STATUS)
    .limit(1)
    .get()
  if (!existing.empty) return

  await firestore.collection(NOTIFICATIONS_COLLECTION).add({
    type: 'pulseQuestionSetMissing',
    audience: 'companyAdmin',
    companyId,
    status: PENDING_STATUS,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// The single per-company queueing loop, shared by the daily scheduler above and
// the on-demand trigger in sendPulseChecksNow.js so the two can never drift.
// Given a company doc and the cadence (in days) to size the invite window with,
// it queues one pulse-check invite notification per active roster employee and
// stamps lastPulseCheckSentAt. It intentionally does NOT check isDue: cadence
// gating is the scheduler's job, and the manual trigger bypasses it on purpose.
//
// Returns { queued } - the number of invites actually queued. An empty roster
// queues nothing and, matching the scheduler's long-standing behaviour, leaves
// lastPulseCheckSentAt untouched so the company becomes due again the moment a
// roster is imported rather than waiting out another full cadence.
//
// Throws NoPublishedQuestionSetError if the company has never published a
// questionnaire. Each caller decides how to report that (the scheduler writes a
// notification, the on-demand send returns an error to the admin pressing the
// button), but neither of them sends.
async function queuePulseInvitesForCompany(firestore, companyDoc, cadenceDays) {
  // Read at the top of the send, once, and stamped identically onto every
  // invite in it: everyone in a single send answers the same questionnaire even
  // if a publish lands mid-loop.
  const questionSetVersion = companyDoc.data().activeQuestionSetVersion
  if (!Number.isInteger(questionSetVersion) || questionSetVersion < 1) {
    throw new NoPublishedQuestionSetError(companyDoc.id)
  }

  const employeesSnapshot = await companyDoc.ref.collection(EMPLOYEES_SUBCOLLECTION).get()
  if (employeesSnapshot.empty) {
    logger.info('queuePulseInvitesForCompany: no employees on roster, skipping', {
      companyId: companyDoc.id,
    })
    return { queued: 0 }
  }

  const batch = firestore.batch()
  let queued = 0

  for (const employeeDoc of employeesSnapshot.docs) {
    const employee = employeeDoc.data()
    if (employee.status === 'inactive') continue

    // One live invite per employee. Before minting a new invite, retire any
    // invite for this same employee that is still 'pending' by marking it
    // 'superseded' - an employee holding an older link is told a newer one
    // exists (validatePulseInvite maps 'superseded' to reason 'expired')
    // rather than having two live links at once. Done before createPulseInvite
    // below so the invite we are about to create is never caught by this query.
    const existingInvites = await firestore
      .collection(PULSE_INVITES_COLLECTION)
      .where('companyId', '==', companyDoc.id)
      .where('employeeId', '==', employeeDoc.id)
      .where('status', '==', PENDING_STATUS)
      .get()
    existingInvites.forEach((inviteDoc) => {
      batch.update(inviteDoc.ref, { status: 'superseded' })
    })

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
      // Fixed when the invite is minted, not when it is answered. An employee
      // holding a link sent before a publish answers what they were sent.
      questionSetVersion,
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
    queued += 1
  }

  batch.update(companyDoc.ref, {
    lastPulseCheckSentAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  await batch.commit()
  return { queued }
}

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
    // A company with Pulse Check turned off is skipped before any of the
    // cadence bookkeeping below - "off" must stop new invites from being
    // queued, not merely hide the roster/questions nav in the admin panel.
    if (!resolveFlag(company, 'pulseCheck')) continue
    const cadenceDays = CADENCE_DAYS[company.pulseCheckCadence]
    if (!cadenceDays || !isDue(company, cadenceDays)) continue

    try {
      await queuePulseInvitesForCompany(firestore, companyDoc, cadenceDays)
    } catch (err) {
      // A missing questionnaire is a configuration gap, not a fault: it is
      // reported to the Company Admin who can close it, and logged at info so
      // it doesn't sit in the error stream every morning until they do.
      if (err instanceof NoPublishedQuestionSetError) {
        logger.info('schedulePulseChecks: no published question set, not sending', {
          companyId: companyDoc.id,
        })
        await notifyMissingQuestionSet(firestore, companyDoc.id)
        continue
      }
      logger.error('schedulePulseChecks: failed to queue invites', { companyId: companyDoc.id, error: err.message })
    }
  }
})

exports.queuePulseInvitesForCompany = queuePulseInvitesForCompany
exports.notifyMissingQuestionSet = notifyMissingQuestionSet
exports.NoPublishedQuestionSetError = NoPublishedQuestionSetError
exports.CADENCE_DAYS = CADENCE_DAYS
