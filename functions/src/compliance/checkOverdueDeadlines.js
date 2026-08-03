const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const NOTIFICATIONS_COLLECTION = 'notifications'
const CLOSED_STATUS = 'closed'
const ESCALATION_WINDOW_MS = 48 * 60 * 60 * 1000

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

// Runs daily. Walks every open case and, for each tracked deadline not yet
// actioned, escalates to the HR Coordinator dashboard once that deadline is
// within 48 hours away or already passed.
exports.checkOverdueDeadlines = onSchedule('every day 00:00', async () => {
  const firestore = admin.firestore()
  const openCasesSnapshot = await firestore.collection(CASES_COLLECTION).where('status', '!=', CLOSED_STATUS).get()

  const now = Date.now()
  const windowEnd = now + ESCALATION_WINDOW_MS

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
        await escalateIfNeeded(firestore, {
          caseId: doc.id,
          companyId: caseData.companyId,
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
})
