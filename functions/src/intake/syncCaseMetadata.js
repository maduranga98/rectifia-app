const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
const { normalizeTier } = require('./submitCase')
const { deriveSubjectSignature, signatureHash, normalizeDepartment, answerFor } = require('../patterns/subjectSignature')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASE_METADATA_COLLECTION = 'caseMetadata'
const COMPANIES_COLLECTION = 'companies'

// The exact set of fields the HR Coordinator dashboard (module 13) is
// allowed to see - category/severityScore/evidenceScore/status/
// assignedHandlerId/department/priority/companyId, plus the two compliance
// deadlines so the dashboard can compute daysUntilDeadline itself. Never
// `responses` (questionnaire free text), never anything from messages/.
// Keeping this an explicit allowlist (not an omit-list) means a future field
// added to cases/{caseId} doesn't leak into this mirror by accident.
//
// routingReason is on the list because it is what routeCase.js records when
// it can't route a case automatically (missing_company_id / no_routing_rule /
// conflict_of_interest) - the Super Admin manual-assignment queue needs it to
// explain why a case is waiting. It is a fixed enum written by routing code,
// never anything the reporter typed.
function pickMetadata(data) {
  return {
    companyId: data.companyId ?? null,
    category: data.category ?? null,
    severityScore: data.severityScore ?? null,
    evidenceScore: data.evidenceScore ?? null,
    status: data.status ?? null,
    routingReason: data.routingReason ?? null,
    assignedHandlerId: data.assignedHandlerId ?? null,
    department: data.department ?? null,
    priority: data.priority ?? data.queuePriority ?? null,
    acknowledgmentDueAt: data.acknowledgmentDueAt ?? null,
    feedbackDueAt: data.feedbackDueAt ?? null,
    createdAt: data.createdAt ?? null,
    // Provenance, not content. An HR Coordinator overseeing a queue needs to
    // know a case came in by phone and was typed up, or that the reporter
    // chose to be identifiable, in order to read the queue at all - but none
    // of these three fields says anything about what was reported or by whom.
    //
    // `reporterIdentity` is not here and must never be added. It is on the
    // case document as an encrypted envelope, and mirroring it would put
    // ciphertext into the one case-derived collection this role CAN read
    // directly, turning a rules-gated vault into a client-readable blob to
    // attack offline. Same for enteredByUid/enteredByRole: who typed a case
    // up is audit-trail material (staffIntakeAuditLog), not dashboard
    // material, and in a small company naming the intake taker can narrow
    // down who the reporter is.
    //
    // `contactEmail` (module 20) is not here and must never be added either,
    // on exactly the same reasoning: it is an AES-GCM envelope on the case
    // document, and mirroring it would drop ciphertext into the one
    // case-derived collection an HR Coordinator reads directly, where it could
    // be pulled down and attacked offline at leisure. A dashboard has no
    // question that a reporter's contact address answers, and the reporter was
    // told the address is a delivery detail, not case content.
    //
    // `tier` below DOES keep mirroring after module 20, and now legitimately
    // changes over the life of a case rather than being fixed at submission -
    // a reporter can move their own case from anonymous to confidential
    // (functions/src/intake/identityTransition.js), and this trigger fires on
    // that write like any other, so the mirror follows. That is the intended
    // behaviour: a queue reader needs to know a reporter is identifiable to
    // read the queue at all. It says nothing about who they are - reading that
    // still requires revealIdentity, a documented reason, and an audit entry.
    // tierChangedAt/tierChangedBy are deliberately left off: when the reporter
    // changed their mind is timeline detail for the case report, not a
    // dashboard column.
    tier: normalizeTier(data.tier),
    source: data.source ?? 'reporter',
    intakeMethod: data.intakeMethod ?? null,
    // Retaliation follow-up (functions/src/followup/*), metadata only. The HR
    // Coordinator sees the coarse per-case rollup status and when the next
    // prompt is due - counts and statuses, never the reporter's free-text
    // answer, which is case content and never lives on this case at all.
    // 'no_response' here means UNKNOWN (the reporter did not return); it must
    // never be read or shown as evidence that no retaliation occurred.
    // Deliberately nothing identity-bearing is added.
    followUpStatus: data.followUpStatus ?? null,
    nextFollowUpAt: data.nextFollowUpAt ?? null,
    // Timestamps, not content - added for functions/src/analytics/
    // aggregateCaseAnalytics.js (module 28), which is contractually barred
    // from ever reading cases/{caseId} directly and needs closedAt to
    // compute time-to-resolution and acknowledgmentSentAt/feedbackGivenAt to
    // compute the compliance-deadline hit rate against the due dates already
    // mirrored above. actionTaken (a fixed enum from
    // consistency/actionVocabulary.js, the same vocabulary the reference
    // pool already stores) lets the analytics module recompute a
    // company-scoped consistency signal from caseMetadata + referenceCases
    // alone. None of the four says anything about what was reported.
    closedAt: data.closedAt ?? null,
    acknowledgmentSentAt: data.acknowledgmentSentAt ?? null,
    feedbackGivenAt: data.feedbackGivenAt ?? null,
    actionTaken: data.actionTaken ?? null,
    ...subjectSignatureFields(data),
    ...reporterDepartmentField(data),
  }
}

// burnout-only mirror of the reporter's own department, for
// functions/src/patterns/detectBurnoutTrends.js. This is deliberately NOT
// part of subjectSignatureFields() above: burnout has no subject party (see
// subjectSignature.js's SUBJECT_FIELDS), and this describes the REPORTER,
// not a person the report is about. Keeping it a separate field under a
// separate name is what stops a future query from accidentally joining it
// against subjectDepartment/subjectSignatureHash - department-level report
// volume and per-person conduct clustering are structurally different
// signals and must never merge into one collection or one grouping key.
function reporterDepartmentField(data) {
  if (data.category !== 'burnout') return {}
  return {
    reporterDepartment: normalizeDepartment(answerFor(data.responses, 'reporter_department')) || null,
  }
}

// The three fields module 16's pattern detection groups on, derived here
// rather than read from the case so that detectPatterns.js never needs a path
// to cases/{caseId} or to `responses`.
//
// They are deliberately NOT the `department` field above. That one is the
// case's own routing department (routeCase.js, and the column four admin
// screens already render); these describe the person the report is ABOUT, and
// collapsing the two would silently change what those screens display and what
// routing rules match on. Different question, different field.
//
// A tier is a bucket of a job title and a department is a team - together they
// are the coarsest description of a subject that is still groupable, and
// nothing here is identity-bearing on its own. What makes a *signal* built
// from them safe is not this function, it is the population check in
// patterns/suppressionRules.js: department + tier IS an identity when only
// three people match it. Nothing free-text, no answer values, and no reporter
// attribute is mirrored here - deriveSubjectSignature returns a tier and a
// normalized department or it returns null.
function subjectSignatureFields(data) {
  const signature = deriveSubjectSignature({
    companyId: data.companyId,
    category: data.category,
    responses: data.responses,
  })
  if (!signature) {
    return { subjectDepartment: null, subjectRoleTier: null, subjectSignatureHash: null }
  }
  return {
    subjectDepartment: signature.department,
    subjectRoleTier: signature.roleTier,
    subjectSignatureHash: signatureHash(signature),
  }
}

// Mirrors every write to cases/{caseId} into a metadata-only sibling doc,
// the same "separate mirror collection, not field-level rules" pattern
// storeReferenceCase.js already uses for module 10. firestore.rules opens
// caseMetadata/{caseId} to the HR Coordinator role directly, so this mirror
// - not any rule on cases/{caseId} itself - is what makes "metadata only" an
// enforceable server-side guarantee rather than a client-side filter.
// Exported so functions/src/security/integrityCheck.js can re-derive exactly
// what a case's mirror SHOULD contain and diff it against what is actually
// stored, without a second, hand-maintained copy of this allowlist drifting
// from the real one - the drift check would otherwise be checking the
// mirror against its own stale idea of itself.
exports.pickMetadata = pickMetadata

exports.syncCaseMetadata = onDocumentWritten('cases/{caseId}', async (event) => {
  const after = event.data.after
  const firestore = admin.firestore()
  const caseId = event.params.caseId

  if (!after.exists) {
    await firestore.collection(CASE_METADATA_COLLECTION).doc(caseId).delete()
    return
  }

  const data = after.data()
  await firestore.collection(CASE_METADATA_COLLECTION).doc(caseId).set(pickMetadata(data), { merge: true })

  const isNewCase = !event.data.before.exists
  if (isNewCase && data.companyId) {
    // Read-only usage counter for the Company Admin billing view - counts
    // volume only, never touches case content, and resetting it per billing
    // period is left to whatever module eventually owns subscription
    // renewal (out of scope here: "no payment processing logic").
    await firestore
      .collection(COMPANIES_COLLECTION)
      .doc(data.companyId)
      .update({ currentPeriodCaseCount: admin.firestore.FieldValue.increment(1) })
      .catch(() => {})
  }
})
