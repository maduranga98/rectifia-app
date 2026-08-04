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

// Metadata only, same allowlist caseThread.js applies on read. In particular
// no URL is emitted: attachments are opened by asking
// requestEvidenceDownloadUrl for a fresh short-lived signed URL, so a report
// (or an exported PDF of one) is a list of what evidence exists rather than a
// set of live links to it. Documents written before the storage lockdown may
// still carry `url`/`path`; those URLs no longer work and are dropped here.
function serializeAttachment(attachment) {
  return {
    fileName: attachment?.fileName ?? null,
    label: attachment?.label ?? attachment?.filename ?? attachment?.fileName ?? 'Attachment',
    contentType: attachment?.contentType ?? null,
    sizeBytes: attachment?.sizeBytes ?? null,
    uploadedAt: toMillis(attachment?.uploadedAt),
  }
}

function serializeMessage(doc) {
  const data = doc.data()
  return {
    id: doc.id,
    sender: data.sender,
    type: data.type ?? 'message',
    text: data.text ?? '',
    attachments: Array.isArray(data.attachments) ? data.attachments.map(serializeAttachment) : [],
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

  // Reporter identity is never included for 'anonymous'-tier cases, and for
  // a case with no `tier` at all - one written before the field existed -
  // 'anonymous' is the reading, so those fall through here too.
  //
  // For a 'confidential'-tier case this reports the *existence and shape* of
  // the identity record, never its contents. The values are an AES-GCM
  // envelope written by createCaseOnBehalf.js through
  // functions/src/utils/identityVault.js, and this function deliberately does
  // not decrypt them: decryptIdentity() requires a live Super Admin session
  // and a documented reason and writes an identityAccessAuditLog entry every
  // time, and a report generated for whoever happens to open a case is none
  // of those things. Emitting the ciphertext instead would be worse than
  // useless - it would move the vault into a payload that gets rendered,
  // cached, and exported.
  //
  // What a reader of a case report actually needs from this section is
  // whether an identity exists and how to lawfully reach it, and that is
  // exactly what is returned. It stays under its own separated key rather
  // than merged into `summary` so a consumer can gate rendering it behind
  // its own access control instead of it riding along with the rest of the
  // report by default.
  if (caseData.tier === 'confidential' && caseData.reporterIdentity) {
    report.restrictedReporterIdentity = {
      status: 'On file, encrypted in the identity vault',
      detailsOnFile: (caseData.reporterIdentity.fieldsOnFile ?? []).join(', ') || 'unspecified',
      access:
        'Decryption requires a Super Admin, a documented legal reason, and is recorded in the identity access audit log.',
    }
  }

  return { report }
})
