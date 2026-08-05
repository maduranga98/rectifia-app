const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole } = require('../utils/staffAuth')
const { enforceRateLimit } = require('../utils/rateLimit')
const { queuePulseInvitesForCompany, CADENCE_DAYS } = require('./schedulePulseChecks')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// The on-demand counterpart of schedulePulseChecks.js. A Company Admin (or HR
// Coordinator) presses "Send check-in now" and this queues an invite for every
// active roster employee immediately, bypassing the cadence's isDue gate - but
// nothing else. It reuses queuePulseInvitesForCompany, so the two paths queue
// identical documents, supersede outstanding links the same way, and stamp
// lastPulseCheckSentAt the same way. It only queues; actual delivery stays with
// deliverNotifications.js, exactly as the scheduler does - no email is sent
// from here.
//
// Roles: companyAdmin and hrCoordinator ONLY. A manager, caseHandler, or
// pulseCheckReviewer must not be able to trigger a company-wide send. The
// company is resolved from the caller's verified custom claim, never from the
// request payload, so a staff member cannot aim a send at another company's
// roster.
const SEND_PULSE_ROLES = ['companyAdmin', 'hrCoordinator']

exports.sendPulseChecksNow = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  // Company from the trusted token claim, not the request body. Checked
  // against the staff subcollection by loadCallerRole below, so a stale claim
  // on a deactivated account still fails.
  const companyId = request.auth?.token?.companyId
  if (!companyId) {
    throw new HttpsError(
      'permission-denied',
      'Your account is not linked to a company, so it cannot send pulse checks'
    )
  }

  const role = await loadCallerRole(firestore, companyId, uid)
  if (!SEND_PULSE_ROLES.includes(role)) {
    throw new HttpsError(
      'permission-denied',
      'Only a Company Admin or HR Coordinator may send a pulse check on demand'
    )
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnap = await companyRef.get()
  if (!companySnap.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }

  // The invite expiry window is still createdAt + cadenceDays: the manual send
  // bypasses the cadence *timer*, not the cadence *setting*. A company with no
  // cadence configured has no window to size an invite with, so it must set one
  // before it can send - rather than silently inventing an expiry rule here.
  const cadenceDays = CADENCE_DAYS[companySnap.data().pulseCheckCadence]
  if (!cadenceDays) {
    throw new HttpsError(
      'failed-precondition',
      'Set a pulse-check cadence before sending a check-in.'
    )
  }

  // At most one send per company per hour, scoped by company rather than by
  // caller so two admins cannot each fire a company-wide send within the same
  // window. Enforced only after the validation above, so a misconfiguration
  // does not burn the company's hourly budget.
  await enforceRateLimit(firestore, 'sendPulseChecksNow', request, {
    scope: `company:${companyId}`,
  })

  const { queued } = await queuePulseInvitesForCompany(firestore, companySnap, cadenceDays)
  logger.info('sendPulseChecksNow: queued invites', { companyId, queued, actorUid: uid })

  return { queued }
})
