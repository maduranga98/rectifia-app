const { onCall } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')
const { resolveResponse } = require('../reports/questionCatalog')

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
//
// Exported (as compileReport) so functions/src/reports/exportReportPdf.js can
// call the exact same compile logic generateReport's onCall handler below
// uses, rather than re-querying Firestore or building a second serialization
// path that could drift from what CaseReport.jsx renders on screen. The
// caller supplies an already-authenticated uid; authorization (loadCaseForHandler)
// happens inside, identically for both callers.
async function compileReport(firestore, caseId, uid) {
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

  // "Policy in effect": the distinct policy documents (title + version) whose
  // clauses grounded this case's AI steps, taken from the citations recorded on
  // the case doc at the time. Records provenance, not the clause text - the
  // report states which written policy was in force when the case was worked,
  // which is exactly what a later reader needs and what versioning preserves
  // even after a document is re-uploaded or archived. Empty for cases worked
  // before any policy was uploaded.
  const citations = Array.isArray(caseData.policyCitations) ? caseData.policyCitations : []
  const policyInEffect = Object.values(
    citations.reduce((acc, citation) => {
      const policyId = citation?.policyId
      if (!policyId || acc[policyId]) return acc
      acc[policyId] = {
        policyId,
        title: citation.title ?? null,
        version: typeof citation.version === 'number' ? citation.version : null,
      }
      return acc
    }, {})
  )

  // The questionnaire the reporter originally answered, with each question's
  // text resolved alongside its answer (functions/src/reports/questionCatalog.js)
  // rather than left as a bare questionId. `responses` lives directly on the
  // case doc (submitCase.js / createCaseOnBehalf.js write it there, not in a
  // subcollection), so this needs no extra Firestore read. A case created
  // before a questionnaire was submitted has no `responses` yet, hence the
  // array fallback.
  const questionnaire = Array.isArray(caseData.responses)
    ? caseData.responses.map((response) => resolveResponse(caseData.category, response))
    : []

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
    questionnaire,
    evidence,
    manualLogEntries,
    policyInEffect,
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
  //
  // The tier read here is the case's CURRENT tier, which since module 20 is no
  // longer necessarily the tier it was filed at: a reporter can move their own
  // case from anonymous to confidential mid-investigation
  // (functions/src/intake/identityTransition.js). Keying off the current value
  // is what makes the section appear at all for those cases - but presenting a
  // self-revealed reporter identically to one who was confidential from the
  // first message would quietly lose something an investigator needs. When the
  // reporter was anonymous for the first three weeks, that is a fact about how
  // the case was worked: the early thread was written by someone the
  // investigator could not name, and the disclosure has a date the reader can
  // line up against the timeline. So `tierChanged` carries the transition and
  // its timestamp whenever one happened.
  //
  // `contactEmail` is not reported here at all, in any form - not the
  // ciphertext, not a presence flag. Whether a reporter chose to be reachable
  // is a delivery detail of their own, it is not evidence, and a report is a
  // document that gets exported and circulated. The one place it is legible is
  // the reporter's own case view.
  //
  // tierChangedBy is always 'reporter' today, because there is no other writer
  // - no staff path can change a case's tier. It is reported rather than
  // assumed so that a reader is told who made the change instead of inferring
  // it, and so a future writer could not appear here unlabelled.
  if (caseData.tier === 'confidential' && caseData.reporterIdentity) {
    report.restrictedReporterIdentity = {
      status: 'On file, encrypted in the identity vault',
      detailsOnFile: (caseData.reporterIdentity.fieldsOnFile ?? []).join(', ') || 'unspecified',
      access:
        'Decryption requires a Super Admin, a documented legal reason, and is recorded in the identity access audit log.',
      tierChanged: caseData.tierChangedAt
        ? {
            from: 'anonymous',
            to: 'confidential',
            at: toMillis(caseData.tierChangedAt),
            by: caseData.tierChangedBy ?? 'reporter',
            note: 'This case was filed anonymously. The reporter later chose to identify themselves; nobody asked them to, and it cannot be reversed.',
          }
        : null,
    }
  }

  return { report, caseData, caseRef }
}

exports.compileReport = compileReport

exports.generateReport = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId } = request.data || {}
  const firestore = admin.firestore()
  const { report } = await compileReport(firestore, caseId, uid)
  return { report }
})
