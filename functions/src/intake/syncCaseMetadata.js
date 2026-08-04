const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')

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
  }
}

// Mirrors every write to cases/{caseId} into a metadata-only sibling doc,
// the same "separate mirror collection, not field-level rules" pattern
// storeReferenceCase.js already uses for module 10. firestore.rules opens
// caseMetadata/{caseId} to the HR Coordinator role directly, so this mirror
// - not any rule on cases/{caseId} itself - is what makes "metadata only" an
// enforceable server-side guarantee rather than a client-side filter.
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
