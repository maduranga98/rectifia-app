const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { classifyRoleText } = require('../consistency/departmentTier')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const COMPANIES_COLLECTION = 'companies'
const ROUTING_RULES_SUBCOLLECTION = 'routingRules'
const STAFF_SUBCOLLECTION = 'staff'
const NOTIFICATIONS_COLLECTION = 'notifications'
const SUPER_ADMINS_COLLECTION = 'superAdmins'

const LOW_SCORE_THRESHOLD = 30
const HIGH_SEVERITY_THRESHOLD = 70

// Maps a case category to the questionnaire fields that name the accused
// person's department + role. harassment.js and retaliation.js deliberately
// share the same field id pair as toxicManagement.js's original pair (see
// the comment at the top of harassment.js) so that this map - and the
// conflict-of-interest check below - doesn't have to care which
// questionnaire a case came from. burnout has no subject party and is
// absent on purpose; inventing fields for it would mean guessing a subject
// the questionnaire never asked about.
const ACCUSED_PROFILE_FIELDS = {
  toxicManagement: {
    departmentQuestionId: 'toxic_manager_department',
    roleQuestionId: 'toxic_manager_role',
  },
  harassment: {
    departmentQuestionId: 'subject_department',
    roleQuestionId: 'subject_role',
  },
  retaliation: {
    departmentQuestionId: 'subject_department',
    roleQuestionId: 'subject_role',
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
// than exact string equality - accused department is a company-department
// select value, so a reporter's "Engineering" and a staff record's " eng "
// should still trip the check. Favors over-flagging (resolved by a human via
// the manual-assignment fallback) over under-flagging a real conflict.
function textMatches(a, b) {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

// The accused's role is a canonical tier value now (junior/senior/manager/
// unspecified - see harassment.js's subject_role), but a staff record's
// jobTitle is still a free-text job title ("Senior Engineering Manager").
// Comparing them with textMatches would be meaningless - a staff record
// holds a title, not a tier - so classifyRoleText runs over the staff side to
// put both in the same vocabulary before comparing. 'unspecified' never
// counts as a match on either side: it means "we don't know", not "these two
// match", and treating it as a match would flag a conflict merely because
// neither role could be classified.
function rolesConflict(staffJobTitle, accusedRole) {
  const staffTier = classifyRoleText(staffJobTitle)
  const accusedTier = classifyRoleText(accusedRole)
  if (staffTier === 'unspecified' || accusedTier === 'unspecified') return false
  return staffTier === accusedTier
}

// Resolves the routing department for a case from the same questionnaire
// answer the conflict-of-interest check reads (ACCUSED_PROFILE_FIELDS) -
// the subject's department, never the reporter's own (not collected, and
// collecting it would narrow the anonymity set). Returns null when the
// category has no subject-department field or the reporter left it blank,
// so the caller can fall back to 'unspecified' rather than routing on a
// half-answer. Only whitespace/case are normalised here - no fuzzy matching
// against the company's department list, which textMatches already does
// for the conflict check with different tolerance requirements.
function resolveRoutingDepartment(category, responses) {
  const fields = ACCUSED_PROFILE_FIELDS[category]
  if (!fields) return null

  const raw = responses.find((r) => r.questionId === fields.departmentQuestionId)?.value
  if (typeof raw !== 'string') return null

  const normalized = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalized || null
}

exports.resolveRoutingDepartment = resolveRoutingDepartment

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

    if (textMatches(staff.department, accusedProfile.department) && rolesConflict(staff.jobTitle, accusedProfile.role)) {
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
    audience: 'superAdmin',
    companyId: companyId ?? null,
    caseId,
    category: category ?? null,
    department: department ?? null,
    reason,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
  })
}

// The company-side counterpart, for the one manual-assignment reason the
// company can actually fix: a missing routing rule is their configuration, so
// escalating it to the platform operator only to have them assign one case by
// hand leaves the same gap open for the next case. Same notifications
// collection, same metadata-only shape as notifySuperAdmin above; recipient
// emails come from the company's own companyAdmin staff records, the same
// place inviteStaff.js writes them.
async function notifyCompanyAdmin({ firestore, companyId, caseId, category, department, reason }) {
  let recipientEmails = []
  if (companyId) {
    const adminsSnapshot = await firestore
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection(STAFF_SUBCOLLECTION)
      .where('role', '==', 'companyAdmin')
      .get()
    recipientEmails = adminsSnapshot.docs.map((d) => d.data().email).filter(Boolean)
  }

  if (recipientEmails.length === 0) {
    logger.error('routeCase: no Company Admin to notify about an unrouted case', { caseId, companyId })
  }

  await firestore.collection(NOTIFICATIONS_COLLECTION).add({
    type: 'companyAdminReview',
    audience: 'companyAdmin',
    companyId: companyId ?? null,
    caseId,
    category: category ?? null,
    department: department ?? null,
    reason,
    recipientEmails,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'pending',
  })
}

// Which desk a stuck case lands on, keyed by the reason routing gave up.
// The reason values themselves are unchanged - 'no_routing_rule' just stops
// going to the platform operator:
//   no_routing_rule      -> the company's own configuration gap, fixed on
//                           RoutingRulesPage by writing the missing rule (or
//                           assigning this one case by hand).
//   conflict_of_interest -> deliberately never the company's own call; the
//                           people who would resolve it are the ones the
//                           conflict check just implicated.
//   missing_company_id   -> no company to route to at all, so nobody but the
//                           platform operator can place it.
const MANUAL_ASSIGNMENT_AUDIENCE = {
  no_routing_rule: 'companyAdmin',
  conflict_of_interest: 'superAdmin',
  missing_company_id: 'superAdmin',
}

async function sendToManualAssignment(firestore, caseRef, { companyId, caseId, category, department, reason, priority }) {
  await caseRef.update({
    status: 'needs_manual_assignment',
    routingReason: reason,
    priority,
    department: department ?? 'unspecified',
  })

  const audience = MANUAL_ASSIGNMENT_AUDIENCE[reason] ?? 'superAdmin'
  const notify = audience === 'companyAdmin' ? notifyCompanyAdmin : notifySuperAdmin
  await notify({ firestore, companyId, caseId, category, department, reason })

  logger.info('routeCase: sent to manual assignment', { caseId, companyId, reason, audience })
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

  // Resolution order: a department already set on the case document wins
  // (nothing sets one today, but a future path might); otherwise resolve it
  // from the subject-department questionnaire answer (ACCUSED_PROFILE_FIELDS
  // - the subject's department, never the reporter's own); otherwise the
  // honest fallback. routingRules can still be configured for an
  // 'unspecified' bucket per category for cases that never named one.
  const department =
    after.department || resolveRoutingDepartment(after.category, after.responses || []) || 'unspecified'

  if (!companyId) {
    // Nothing to route against without knowing the company - never leave
    // this silently unassigned.
    await sendToManualAssignment(firestore, caseRef, {
      companyId: null,
      caseId,
      category: after.category,
      department,
      reason: 'missing_company_id',
      priority,
    })
    return
  }

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
    department,
  })
})

// Super Admin is allowlist membership at superAdmins/{uid}, not a custom
// claim - the same check firestore.rules, authService.checkSuperAdmin, and
// createCompanyAdmin.js make.
async function isSuperAdminUid(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

const MANUAL_ASSIGNMENT_NOTIFICATION_TYPES = ['superAdminReview', 'companyAdminReview']

// Closes out the queued manual-assignment signals for a case once a human has
// actually assigned it, so the 'pending' rows notifySuperAdmin /
// notifyCompanyAdmin write don't pile up forever. Filtered on caseId alone
// and narrowed in memory - three equality filters would be a composite index
// for a handful of docs.
async function resolveManualAssignmentNotifications(firestore, caseId, actorUid) {
  const snapshot = await firestore
    .collection(NOTIFICATIONS_COLLECTION)
    .where('caseId', '==', caseId)
    .get()

  const batch = firestore.batch()
  let pendingCount = 0
  snapshot.docs.forEach((notificationDoc) => {
    const data = notificationDoc.data()
    if (!MANUAL_ASSIGNMENT_NOTIFICATION_TYPES.includes(data.type) || data.status !== 'pending') return
    pendingCount += 1
    batch.update(notificationDoc.ref, {
      status: 'resolved',
      resolvedBy: actorUid,
      resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  })

  if (pendingCount > 0) await batch.commit()
}

// Admin-facing manual reassignment. Case documents are locked down in
// firestore.rules (no direct client read/write), so this callable - run
// with the Admin SDK - is the only path routingService.js has to change who
// a case is assigned to. Used both for ordinary reassignment and to resolve
// a 'needs_manual_assignment' case once a Super Admin has picked someone
// appropriate (this v1 does not re-run the conflict-of-interest check -
// that's the point of routing it to a human in the first place).
exports.reassignCase = onCall(async (request) => {
  const actorUid = requireAuthUid(request)
  const { caseId, companyId, handlerId } = request.data || {}
  if (!caseId || !companyId || !handlerId) {
    throw new HttpsError('invalid-argument', 'caseId, companyId, and handlerId are required')
  }

  const firestore = admin.firestore()

  // Reassignment is an oversight action (HR Coordinator via
  // HRCoordinatorDashboard), not something the assigned handler does - verify
  // the authenticated caller's role from their staff record keyed by
  // request.auth.uid, never a client-supplied actorId.
  //
  // Company Admin is included too, but narrower - the same carved-out
  // exception as TRIAGE_ROLES in staffAuth.js (see the comment there): the
  // one case-derived action this role gets is placing a case stuck on its own
  // routing-configuration gap, matching what CasesPage.jsx's UI already
  // exposes and what firestore.rules' caseMetadata read already lets it see.
  // The scope check on caseData a few lines below - status ==
  // 'needs_manual_assignment' AND routingReason == 'no_routing_rule' - is
  // what keeps this from becoming general reassignment power; role
  // membership here only says "no need to ask a human", not "this specific
  // case is fair game". HR Coordinator can reassign using metadata alone,
  // which is all this action needs.
  //
  // A platform Super Admin is also allowed through, and is the only caller who
  // can be resolving a case from the manual-assignment queue on
  // SuperAdminDashboardPage: they belong to no company, so they have no staff
  // record for loadCallerRole to find. This is now the only path for a case
  // that has no eligible non-conflicted company staff to route to
  // automatically.
  const REASSIGN_ROLES = ['hrCoordinator', 'companyAdmin']
  const superAdmin = await isSuperAdminUid(firestore, actorUid)
  let actorRole = null
  if (superAdmin) {
    await logPrivilegedAction(firestore, {
      uid: actorUid,
      companyId,
      role: 'superAdmin',
      action: 'case_reassign',
      outcome: 'granted',
      caseId,
    })
  } else {
    actorRole = await loadCallerRole(firestore, companyId, actorUid, 'case_reassign')
    if (!REASSIGN_ROLES.includes(actorRole)) {
      await logPrivilegedAction(firestore, {
        uid: actorUid,
        companyId,
        role: actorRole,
        action: 'case_reassign',
        outcome: 'denied:permission-denied',
        caseId,
        detail: 'role_not_reassign_role',
      })
      throw new HttpsError('permission-denied', 'You do not have permission to reassign cases')
    }
    await logPrivilegedAction(firestore, {
      uid: actorUid,
      companyId,
      role: actorRole,
      action: 'case_reassign',
      outcome: 'granted',
      caseId,
    })
  }

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

  const caseData = caseSnapshot.data()

  // A conflict-of-interest case is one where the company's own routing target
  // (or a Company Admin) matched the department and role of the person being
  // reported on. Letting anyone inside that company resolve it - Company
  // Admin or HR Coordinator, deliberately or by accident through the ordinary
  // reassign control - would hand the case back to the people the check just
  // implicated, so the only caller who can place it is the platform operator.
  if (
    caseData.status === 'needs_manual_assignment' &&
    caseData.routingReason === 'conflict_of_interest' &&
    !superAdmin
  ) {
    throw new HttpsError(
      'permission-denied',
      'This case is flagged for conflict of interest and can only be assigned by a Super Admin'
    )
  }

  // Company Admin's slice of REASSIGN_ROLES above is deliberately narrower
  // than HR Coordinator's: it may only place a case stuck on its own
  // routing-configuration gap, never reassign a case that already has a
  // handler or is waiting on anything else. This is what keeps role
  // membership in REASSIGN_ROLES from being general reassignment power for
  // this role - the conflict_of_interest guard above already rules out that
  // one reason, this rules out every other case shape.
  if (
    actorRole === 'companyAdmin' &&
    (caseData.status !== 'needs_manual_assignment' || caseData.routingReason !== 'no_routing_rule')
  ) {
    throw new HttpsError(
      'permission-denied',
      'A Company Admin can only assign cases waiting on a missing routing rule'
    )
  }

  // The caller's authority was established against `companyId`, so that had
  // better be the company this case actually belongs to - otherwise a Company
  // Admin could hand another tenant's case to one of their own staff.
  const caseCompanyId = caseData.companyId ?? null
  if (caseCompanyId && caseCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'This case belongs to a different company')
  }

  // A case routed with reason 'missing_company_id' never got a company at all,
  // so assigning a handler also has to record which company that handler
  // belongs to - otherwise the case stays orphaned from every company-scoped
  // view. Only a Super Admin can make that call; a company-scoped role
  // adopting a stray case into their own tenant is exactly the move the check
  // above exists to prevent.
  const update = {
    assignedHandlerId: handlerId,
    assignedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'assigned',
    routingReason: 'manual_reassignment',
    reassignedBy: actorUid,
  }
  if (!caseCompanyId) {
    if (!superAdmin) {
      throw new HttpsError('permission-denied', 'This case is not associated with a company')
    }
    update.companyId = companyId
  }

  await firestore.collection(CASES_COLLECTION).doc(caseId).update(update)
  await resolveManualAssignmentNotifications(firestore, caseId, actorUid)

  return { success: true }
})

// One-off migration for the department-routing fix above: cases scored
// before this deploy never had `department` resolved, so they're sitting in
// needs_manual_assignment showing 'unspecified' even when the reporter did
// name a subject department. This only ever writes `department` - it never
// touches status, priority, or assignedHandlerId, so it does not retroactively
// route anything; a case that was manually queued stays manually queued,
// it just displays the right bucket while it waits. Super Admin only, since
// it can touch every company's cases in one call.
exports.backfillCaseDepartments = onCall(async (request) => {
  const actorUid = requireAuthUid(request)
  const firestore = admin.firestore()

  const superAdmin = await isSuperAdminUid(firestore, actorUid)
  if (!superAdmin) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can run this backfill')
  }

  const { companyId } = request.data || {}

  let query = firestore.collection(CASES_COLLECTION).where('status', '==', 'needs_manual_assignment')
  if (companyId) {
    query = query.where('companyId', '==', companyId)
  }
  const snapshot = await query.get()

  const batch = firestore.batch()
  let updated = 0
  snapshot.docs.forEach((doc) => {
    const data = doc.data()
    const resolved =
      resolveRoutingDepartment(data.category, data.responses || []) || 'unspecified'
    if (resolved === (data.department ?? 'unspecified')) return
    batch.update(doc.ref, { department: resolved })
    updated += 1
  })
  if (updated > 0) await batch.commit()

  logger.info('routeCase: backfillCaseDepartments complete', {
    actorUid,
    companyId: companyId ?? null,
    scanned: snapshot.size,
    updated,
  })

  return { success: true, scanned: snapshot.size, updated }
})
