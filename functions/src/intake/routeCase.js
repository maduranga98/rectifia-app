const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const COMPANIES_COLLECTION = 'companies'
const ROUTING_RULES_SUBCOLLECTION = 'routingRules'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'

const LOW_SCORE_THRESHOLD = 30
const HIGH_SEVERITY_THRESHOLD = 70

// Maps a case category to the questionnaire fields (if any) that name the
// accused person's department + role. Only toxicManagement's questionnaire
// currently collects this by design (see
// src/data/questionnaires/toxicManagement.js) - other categories don't yet
// capture a structured department/role for the accused, so the
// conflict-of-interest check is skipped for them rather than guessed at
// from free text.
const ACCUSED_PROFILE_FIELDS = {
  toxicManagement: {
    departmentQuestionId: 'toxic_manager_department',
    roleQuestionId: 'toxic_manager_role',
  },
}

function routingRuleId(category, department) {
  const safe = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unspecified'
  return `${safe(category)}__${safe(department)}`
}

function determinePriority(severityScore, evidenceScore) {
  if (severityScore < LOW_SCORE_THRESHOLD && evidenceScore < LOW_SCORE_THRESHOLD) return 'low'
  if (severityScore >= HIGH_SEVERITY_THRESHOLD) return 'high'
  return 'medium'
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}

// Deliberately loose match (equality or substring either direction) rather
// than exact string equality - accused department/role are free text, so a
// reporter writing "eng" and a staff record saying "Engineering" should
// still trip the check. Favors over-flagging (resolved by a human via the
// manual-assignment fallback) over under-flagging a real conflict.
function textMatches(a, b) {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function extractAccusedProfile(category, responses) {
  const fields = ACCUSED_PROFILE_FIELDS[category]
  if (!fields) return null

  const department = responses.find((r) => r.questionId === fields.departmentQuestionId)?.value
  const role = responses.find((r) => r.questionId === fields.roleQuestionId)?.value
  if (!department && !role) return null

  return {
    department: typeof department === 'string' ? department : '',
    role: typeof role === 'string' ? role : '',
  }
}

// Checks the candidate handler and every Company Admin for this company
// against the accused person's department + role. Returns the first
// conflicted staff record, or null if there's no conflict (or nothing to
// check against).
async function findConflictedStaff(firestore, companyId, accusedProfile, candidateHandlerId) {
  if (!accusedProfile) return null

  const staffSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .get()

  for (const staffDoc of staffSnapshot.docs) {
    const staff = staffDoc.data()
    const isRelevant = staffDoc.id === candidateHandlerId || staff.role === 'companyAdmin'
    if (!isRelevant) continue

    if (textMatches(staff.department, accusedProfile.department) && textMatches(staff.jobTitle, accusedProfile.role)) {
      return { staffId: staffDoc.id, ...staff }
    }
  }

  return null
}

// Writes a metadata-only notification for a case that needs a human to
// assign it - never case content, never the reporter's account, only enough
// to locate and triage the case. Building the actual delivery (email/SMS/
// push) to the Super Admin is out of scope here; this just queues the
// signal for whatever module reads `notifications`.
async function notifySuperAdmin({ firestore, companyId, caseId, category, department, reason }) {
  await firestore.collection(NOTIFICATIONS_COLLECTION).add({
    type: 'superAdminReview',
    companyId: companyId ?? null,
    caseId,
    category: category ?? null,
    department: department ?? null,
    reason,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
  })
}

async function sendToManualAssignment(firestore, caseRef, { companyId, caseId, category, department, reason, priority }) {
  await caseRef.update({
    status: 'needs_manual_assignment',
    routingReason: reason,
    priority,
  })
  await notifySuperAdmin({ firestore, companyId, caseId, category, department, reason })
  logger.info('routeCase: sent to manual assignment', { caseId, companyId, reason })
}

// Notifies the company's designated crisis contact (module 3's company
// settings - companies/{companyId}.crisisContact). Exported so aiFollowUp.js
// can reuse it if a crisis is newly detected mid-thread, not just at initial
// scoring. Metadata only - no free-text reasoning or questionnaire content
// goes into the notification.
async function notifyCrisisContact({ companyId, caseId, category, severityScore, evidenceScore }) {
  const firestore = admin.firestore()
  let crisisContact = null

  if (companyId) {
    const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
    crisisContact = companySnapshot.exists ? companySnapshot.data().crisisContact ?? null : null
  }

  if (!crisisContact) {
    logger.error('routeCase: no crisis contact configured for company', { caseId, companyId })
  }

  await firestore.collection(NOTIFICATIONS_COLLECTION).add({
    type: 'crisis',
    companyId: companyId ?? null,
    caseId,
    category: category ?? null,
    severityScore: severityScore ?? null,
    evidenceScore: evidenceScore ?? null,
    recipientName: crisisContact?.name ?? null,
    recipientEmail: crisisContact?.email ?? null,
    recipientPhone: crisisContact?.phone ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
  })
}
exports.notifyCrisisContact = notifyCrisisContact

// Runs after scoreCase.js completes - triggered by the same case document
// transitioning from unscored to scored (the update scoreCase.js itself
// makes), not by every later update. A case re-scored later by aiFollowUp.js
// (evidenceScore recalculated as the thread develops) does not re-enter
// routing; it was already routed once.
exports.routeCase = onDocumentUpdated(CASES_COLLECTION + '/{caseId}', async (event) => {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const caseId = event.params.caseId

  const justScored = after.severityScore !== undefined && before.severityScore === undefined
  if (!justScored) return

  const firestore = admin.firestore()
  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)

  if (after.crisisFlag === true) {
    // Bypass normal routing entirely - the crisis contact handles this out
    // of band. We still record that the notification went out.
    await notifyCrisisContact({
      companyId: after.companyId,
      caseId,
      category: after.category,
      severityScore: after.severityScore,
      evidenceScore: after.evidenceScore,
    })
    await caseRef.update({ crisisNotifiedAt: admin.firestore.FieldValue.serverTimestamp() })
    return
  }

  const priority = determinePriority(after.severityScore, after.evidenceScore)
  const companyId = after.companyId ?? null

  if (!companyId) {
    // Nothing to route against without knowing the company - never leave
    // this silently unassigned.
    await sendToManualAssignment(firestore, caseRef, {
      companyId: null,
      caseId,
      category: after.category,
      department: after.department ?? null,
      reason: 'missing_company_id',
      priority,
    })
    return
  }

  // The reporter's own department isn't collected by any questionnaire yet
  // (only the accused's, for toxicManagement) - routingRules can still be
  // configured for an 'unspecified' bucket per category until that's added.
  const department = after.department || 'unspecified'
  const ruleId = routingRuleId(after.category, department)
  const ruleSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(ROUTING_RULES_SUBCOLLECTION)
    .doc(ruleId)
    .get()

  const handlerId = ruleSnapshot.exists ? ruleSnapshot.data().caseHandlerId : null

  if (!handlerId) {
    await sendToManualAssignment(firestore, caseRef, {
      companyId,
      caseId,
      category: after.category,
      department,
      reason: 'no_routing_rule',
      priority,
    })
    return
  }

  const accusedProfile = extractAccusedProfile(after.category, after.responses || [])
  const conflict = await findConflictedStaff(firestore, companyId, accusedProfile, handlerId)

  if (conflict) {
    await sendToManualAssignment(firestore, caseRef, {
      companyId,
      caseId,
      category: after.category,
      department,
      reason: 'conflict_of_interest',
      priority,
    })
    return
  }

  await caseRef.update({
    assignedHandlerId: handlerId,
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'assigned',
    priority,
  })
})

// Admin-facing manual reassignment. Case documents are locked down in
// firestore.rules (no direct client read/write), so this callable - run
// with the Admin SDK - is the only path routingService.js has to change who
// a case is assigned to. Used both for ordinary reassignment and to resolve
// a 'needs_manual_assignment' case once a Super Admin has picked someone
// appropriate (this v1 does not re-run the conflict-of-interest check -
// that's the point of routing it to a human in the first place).
exports.reassignCase = onCall(async (request) => {
  const { caseId, companyId, handlerId, actorId } = request.data || {}
  if (!caseId || !companyId || !handlerId) {
    throw new HttpsError('invalid-argument', 'caseId, companyId, and handlerId are required')
  }

  const firestore = admin.firestore()
  const staffSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .doc(handlerId)
    .get()

  if (!staffSnapshot.exists) {
    throw new HttpsError('not-found', 'No such case handler')
  }

  const caseSnapshot = await firestore.collection(CASES_COLLECTION).doc(caseId).get()
  if (!caseSnapshot.exists) {
    throw new HttpsError('not-found', 'No such case')
  }

  await firestore.collection(CASES_COLLECTION).doc(caseId).update({
    assignedHandlerId: handlerId,
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'assigned',
    routingReason: 'manual_reassignment',
    reassignedBy: actorId ?? null,
  })

  return { success: true }
})
