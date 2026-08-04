const { onCall } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const MESSAGES_SUBCOLLECTION = 'messages'

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : value ?? null
}

function serializeMessage(doc) {
  const data = doc.data()
  return {
    id: doc.id,
    sender: data.sender,
    type: data.type ?? 'message',
    text: data.text ?? '',
    attachments: data.attachments ?? [],
    investigatorId: data.investigatorId ?? null,
    timestamp: toMillis(data.timestamp),
  }
}

// Compiles the final case report for CaseReport.jsx / PDF export. This is a
// read/compile operation only - every Firestore call below is a read, and
// nothing on the case, its thread, or anything else is ever written back.
exports.generateReport = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId } = request.data || {}

  const firestore = admin.firestore()
  const { caseRef, snapshot: caseSnapshot } = await loadCaseForHandler(firestore, caseId, uid)
  const caseData = caseSnapshot.data()

  const messagesSnapshot = await caseRef.collection(MESSAGES_SUBCOLLECTION).orderBy('timestamp', 'asc').get()
  const timeline = messagesSnapshot.docs.map(serializeMessage)

  const evidence = timeline.flatMap((message) =>
    (message.attachments || []).map((attachment) => ({
      ...attachment,
      postedBy: message.sender,
      postedAt: message.timestamp,
    }))
  )

  const manualLogEntries = timeline.filter((message) => message.type === 'manual_log')

  const report = {
    caseId,
    summary: {
      category: caseData.category ?? null,
      status: caseData.status ?? null,
      createdAt: toMillis(caseData.createdAt),
      closedAt: toMillis(caseData.closedAt),
      severityScore: caseData.severityScore ?? null,
      evidenceScore: caseData.evidenceScore ?? null,
      priority: caseData.priority ?? null,
    },
    timeline,
    evidence,
    manualLogEntries,
    consistencyCheck: caseData.consistencyCheck
      ? {
          status: caseData.consistencyCheck.status ?? null,
          flag: caseData.consistencyCheck.flag ?? null,
          similarCaseCount: caseData.consistencyCheck.similarCaseCount ?? null,
          typicalAction: caseData.consistencyCheck.typicalAction ?? null,
          resolutionNotes: caseData.consistencyCheck.resolutionNotes ?? null,
          checkedAt: toMillis(caseData.consistencyCheck.checkedAt),
        }
      : null,
    finalAction: {
      proposedAction: caseData.proposedAction ?? null,
      actionTaken: caseData.actionTaken ?? null,
      actionEffectiveDate: toMillis(caseData.actionEffectiveDate),
      actionNotes: caseData.actionNotes ?? null,
    },
    complianceDeadlineLog: {
      complianceRuleApplied: caseData.complianceRuleApplied ?? null,
      acknowledgmentDueAt: toMillis(caseData.acknowledgmentDueAt),
      acknowledgmentSentAt: toMillis(caseData.acknowledgmentSentAt),
      feedbackDueAt: toMillis(caseData.feedbackDueAt),
      feedbackGivenAt: toMillis(caseData.feedbackGivenAt),
    },
  }

  // Reporter identity is never included for 'anonymous'-tier cases - and
  // nothing in this codebase captures one for them today anyway, since
  // reporters authenticate with a Case ID + passcode, never an account.
  // For 'confidential'-tier cases, if the intake flow has attached a
  // reporterContact field to the case, it's returned under its own
  // separated key rather than merged into `summary`, so a consumer of this
  // report can gate rendering it behind its own access control instead of
  // it riding along with the rest of the report by default.
  if (caseData.tier === 'confidential' && caseData.reporterContact) {
    report.restrictedReporterIdentity = { ...caseData.reporterContact }
  }

  return { report }
})
