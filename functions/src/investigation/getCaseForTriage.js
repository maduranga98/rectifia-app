const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCaseForTriage } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const TRIAGE_ACCESS_LOG_COLLECTION = 'triageAccessLog'

// Triage is a read that exists for exactly one purpose: deciding who a case
// should go to. Once the case has a handler, the handler owns it, so the two
// statuses below are the entire window in which this callable will answer at
// all. 'assigned' and 'closed' are not oversight questions any more.
const TRIAGE_STATUSES = ['open', 'needs_manual_assignment']

// Mirrors the guard in reassignCase (functions/src/intake/routeCase.js): a
// conflict-of-interest case is one where the company's own routing target or
// a Company Admin matched the accused's department and role, so nobody
// inside that company may act on it - and reading it is acting on it. Both
// triage roles are refused, not just Company Admin; the platform operator
// places these cases from the Super Admin queue.
const BLOCKED_ROUTING_REASON = 'conflict_of_interest'

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

// Questionnaire answers, rebuilt field by field. The stored response objects
// (see buildResponses() in src/components/intake/QuestionnaireForm.jsx) also
// carry scoring metadata - severityWeight, crisisCheckCandidate - which is
// module 6's business and has nothing to do with placing a case, so it is
// left behind here rather than shipped to a triage viewer.
//
// The question *text* is not joined on here: the questionnaire definitions
// live in src/data/questionnaires/ and firebase.json deploys only the
// functions/ directory, so the join happens in src/services/triageService.js
// against those same definitions. Copying them into functions/ would make
// two sources of truth for the question wording and let them drift silently.
function pickResponses(responses) {
  if (!Array.isArray(responses)) return []
  return responses.map((response) => ({
    questionId: response.questionId ?? null,
    type: response.type ?? null,
    value: response.value ?? null,
  }))
}

// The entire triage payload, as an explicit allowlist - the same habit
// pickMetadata() follows in functions/src/intake/syncCaseMetadata.js, and for
// the same reason: a field added to cases/{caseId} later (an encrypted
// reporter identity, a burner email mapping, an investigator's notes) must
// not start appearing here just because it was added upstream. The case
// document is never spread.
//
// Nothing from cases/{caseId}/messages is read at all - the thread is
// handler-only and stays that way; there is no subcollection read in this
// file to widen later.
//
// Module 20 is the first live test of that promise, and it passes without a
// line changing here: cases can now carry `reporterIdentity` (written when a
// reporter self-reveals) and `contactEmail` on top of the fields this payload
// was written against, and neither appears below, so neither reaches a triage
// viewer. That is the allowlist doing its job rather than luck - the case
// document is never spread, so a new upstream field is absent by default and
// can only ever appear here by someone typing it into this function.
//
// Neither belongs in triage on its own terms either. Triage answers one
// question - who should work this case - and the identity of the reporter is
// not an input to it. The tier is not returned here either, for the same
// reason it never was: this payload is about the report, not the reporter.
function buildTriagePayload(caseId, caseData) {
  return {
    caseId,
    category: caseData.category ?? null,
    department: caseData.department ?? null,
    severityScore: caseData.severityScore ?? null,
    evidenceScore: caseData.evidenceScore ?? null,
    priority: caseData.priority ?? null,
    status: caseData.status ?? null,
    routingReason: caseData.routingReason ?? null,
    createdAt: toMillis(caseData.createdAt),
    acknowledgmentDueAt: toMillis(caseData.acknowledgmentDueAt),
    feedbackDueAt: toMillis(caseData.feedbackDueAt),
    responses: pickResponses(caseData.responses),
  }
}

// Every attempt to open a case in triage lands here, granted or denied -
// the same "a read of case content is an audited event" rule
// identityAccessAuditLog enforces for decryptIdentity in
// functions/src/utils/identityVault.js. firestore.rules denies every client
// read and write of this collection, including Super Admin: a mutable audit
// trail isn't an audit trail.
async function logTriageAccess(firestore, { caseId, companyId, viewerUid, viewerRole, outcome }) {
  await firestore.collection(TRIAGE_ACCESS_LOG_COLLECTION).add({
    caseId: caseId ?? null,
    companyId: companyId ?? null,
    viewerUid,
    viewerRole: viewerRole ?? null,
    outcome,
    viewedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Returns a sanitized view of one unassigned case so an HR Coordinator or
// Company Admin can read what was reported before deciding who should
// handle it.
//
// This is a callable rather than a rules-gated read on purpose. Firestore
// rules can gate a document but cannot filter its fields, so opening
// cases/{caseId} to these roles would hand them the whole document -
// including anything confidential-tier that is on it now or added later.
// Running with the Admin SDK and returning a hand-built allowlist is the
// only way "these fields and no others" can be a server-side guarantee. No
// read rule on cases/{caseId} is added for either role, and the
// caseMetadata mirror stays exactly as narrow as it was: case content
// appears in the triage modal or nowhere.
exports.getCaseForTriage = onCall(async (request) => {
  const viewerUid = requireAuthUid(request)
  const { caseId } = request.data || {}
  const firestore = admin.firestore()

  // Populated as soon as the case is loaded, so a denial further down is
  // logged against the right company and role rather than as an anonymous
  // failure.
  let companyId = null
  let viewerRole = null

  try {
    const { snapshot, role } = await loadCaseForTriage(firestore, caseId, viewerUid)
    const caseData = snapshot.data()
    companyId = caseData.companyId ?? null
    viewerRole = role

    if (!TRIAGE_STATUSES.includes(caseData.status)) {
      throw new HttpsError(
        'permission-denied',
        'This case has already been assigned - only its handler can read it'
      )
    }

    if (caseData.routingReason === BLOCKED_ROUTING_REASON) {
      throw new HttpsError(
        'permission-denied',
        'This case is flagged for conflict of interest and can only be read and assigned by a Super Admin'
      )
    }

    const payload = buildTriagePayload(caseId, caseData)
    await logTriageAccess(firestore, {
      caseId,
      companyId,
      viewerUid,
      viewerRole,
      outcome: 'granted',
    })
    return payload
  } catch (err) {
    // The denial is the thing most worth recording, so it is logged before
    // the error is re-thrown - but a failure to write the log must not
    // rewrite the error the caller sees into a generic internal one.
    await logTriageAccess(firestore, {
      caseId,
      companyId,
      viewerUid,
      viewerRole,
      outcome: err instanceof HttpsError ? `denied:${err.code}` : 'denied:internal',
    }).catch(() => {})
    throw err
  }
})
