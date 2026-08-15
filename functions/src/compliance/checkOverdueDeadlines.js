const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { recomputeCompanyStats } = require('../company/computeCompanyStats')
const { shouldRunForCompany } = require('../utils/companySchedule')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const CASES_COLLECTION = 'cases'
const NOTIFICATIONS_COLLECTION = 'notifications'
const CLOSED_STATUS = 'closed'
const ESCALATION_WINDOW_MS = 48 * 60 * 60 * 1000

// Local morning, not overnight - an escalation that lands at 8am local reads
// as "start your day with this" instead of arriving while nobody's watching.
const TARGET_LOCAL_HOUR = 8

// Each check pairs the deadline field (set by scheduleDeadlines.js) with the
// field that marks it as already actioned. acknowledgmentSentAt is set the
// moment a case is created, so in practice that half of this never fires for
// cases created after this module existed - it's here so a case whose
// acknowledgment somehow never went out (e.g. legacy data predating this
// feature) still gets caught, not just feedback deadlines.
const DEADLINE_CHECKS = [
  { dueField: 'acknowledgmentDueAt', actionedField: 'acknowledgmentSentAt', type: 'acknowledgmentDeadlineRisk' },
  { dueField: 'feedbackDueAt', actionedField: 'feedbackGivenAt', type: 'feedbackDeadlineRisk' },
]

// One escalation per case+deadline+due-date, not per run - a case that sits
// unactioned in the 48h window (or overdue) for several consecutive days
// should escalate once, not spam a fresh notification every day until it's
// resolved.
async function escalateIfNeeded(firestore, { caseId, companyId, assignedHandlerId, type, dueAt }) {
  const escalationId = `${caseId}_${type}_${dueAt.toMillis()}`
  const ref = firestore.collection(NOTIFICATIONS_COLLECTION).doc(escalationId)
  const existing = await ref.get()
  if (existing.exists) return

  await ref.set({
    type,
    audience: 'hrCoordinator',
    companyId: companyId ?? null,
    caseId,
    assignedHandlerId: assignedHandlerId ?? null,
    dueAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
  })
}

// Deadline arithmetic (acknowledgmentDueAt/feedbackDueAt) is untouched by any
// of this - those stay absolute UTC timestamps computed from reportedAt by
// scheduleDeadlines.js. This module only changes when the sweep notices a
// deadline has arrived, never what the deadline itself is.
async function sweepCompany(firestore, companyId, now, windowEnd) {
  const openCasesSnapshot = await firestore
    .collection(CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('status', '!=', CLOSED_STATUS)
    .get()

  for (const doc of openCasesSnapshot.docs) {
    const caseData = doc.data()

    for (const check of DEADLINE_CHECKS) {
      const dueAt = caseData[check.dueField]
      if (!dueAt) continue
      if (caseData[check.actionedField]) continue

      const dueAtMs = dueAt.toMillis()
      const withinEscalationWindow = dueAtMs <= windowEnd
      if (!withinEscalationWindow) continue

      try {
        // eslint-disable-next-line no-await-in-loop
        await escalateIfNeeded(firestore, {
          caseId: doc.id,
          companyId,
          assignedHandlerId: caseData.assignedHandlerId,
          type: check.type,
          dueAt,
        })
      } catch (err) {
        logger.error('checkOverdueDeadlines: escalation failed', {
          caseId: doc.id,
          type: check.type,
          error: err.message,
        })
      }
    }
  }
}

// Runs hourly; each iteration gates per company on TARGET_LOCAL_HOUR (see
// companySchedule.js) so a company only gets swept once, at its own local
// morning, not once per UTC day for the whole platform. The gate is the
// first thing checked for every company - before any case query - so a
// company whose local hour doesn't match costs one company-doc read and
// nothing else, even though this now runs 24x as often as the old daily
// schedule did.
//
// The escalation dedupe id (caseId_type_dueAt, see escalateIfNeeded) is what
// keeps this idempotent under hourly execution: a case still sitting in the
// window on the next matching hour - or the next day, if the company's local
// morning only comes around once every 24 runs - re-evaluates the same
// dueAt and finds the same doc already written, so it never escalates twice
// for the same deadline.
exports.checkOverdueDeadlines = onSchedule('every 1 hours', async () => {
  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()

  const now = new Date()
  const windowEnd = now.getTime() + ESCALATION_WINDOW_MS
  const sweptCompanyIds = []

  for (const companyDoc of companiesSnapshot.docs) {
    if (!shouldRunForCompany(companyDoc.data(), TARGET_LOCAL_HOUR, now)) continue
    sweptCompanyIds.push(companyDoc.id)
    try {
      // eslint-disable-next-line no-await-in-loop
      await sweepCompany(firestore, companyDoc.id, now, windowEnd)
    } catch (err) {
      logger.error('checkOverdueDeadlines: company sweep failed', { companyId: companyDoc.id, error: err.message })
    }
  }

  // Refreshes the Company Admin overview rollup's overdue/approaching counts
  // for every company actually swept this hour, since those counts drift out
  // of date with the passage of time alone - not just on a caseMetadata
  // write, which is the only other thing that triggers a recompute.
  for (const companyId of sweptCompanyIds) {
    // eslint-disable-next-line no-await-in-loop
    await recomputeCompanyStats(firestore, companyId).catch((err) => {
      logger.error('checkOverdueDeadlines: stats recompute failed', { companyId, error: err.message })
    })
  }
})
