import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

const reassignCaseCallable = httpsCallable(functions, 'reassignCase')

// Must stay in lockstep with routingRuleId() in
// functions/src/intake/routeCase.js - both sides need to land on the same
// doc ID for a given (category, department) pair.
function routingRuleId(category, department) {
  const safe = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unspecified'
  return `${safe(category)}__${safe(department)}`
}

// routingRules and staff live directly under companies/{companyId}, which
// firestore.rules currently leaves open (same no-auth-yet tradeoff as the
// rest of company setup) - so these are plain Firestore reads/writes, not
// callables.
export async function listRoutingRules(companyId) {
  const snapshot = await getDocs(collection(firestore, 'companies', companyId, 'routingRules'))
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function setRoutingRule(companyId, { category, department, caseHandlerId }) {
  if (!category || !department || !caseHandlerId) {
    throw new Error('category, department, and caseHandlerId are required')
  }
  const ruleId = routingRuleId(category, department)
  await setDoc(doc(firestore, 'companies', companyId, 'routingRules', ruleId), {
    category,
    department,
    caseHandlerId,
    updatedAt: serverTimestamp(),
  })
}

export async function removeRoutingRule(companyId, category, department) {
  const ruleId = routingRuleId(category, department)
  await deleteDoc(doc(firestore, 'companies', companyId, 'routingRules', ruleId))
}

export async function listStaff(companyId) {
  const snapshot = await getDocs(collection(firestore, 'companies', companyId, 'staff'))
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function listCaseHandlers(companyId) {
  const staff = await listStaff(companyId)
  return staff.filter((member) => member.role === 'caseHandler')
}

// Flips a staff member between 'active' and 'suspended'. Same plain-write
// tradeoff as routingRules above - status isn't a custom claim, so this
// doesn't touch auth or the role/companyId claims inviteStaff.js stamps.
export async function updateStaffStatus(companyId, staffId, status) {
  if (!['active', 'suspended'].includes(status)) {
    throw new Error('status must be active or suspended')
  }
  await updateDoc(doc(firestore, 'companies', companyId, 'staff', staffId), { status })
}

const CASE_METADATA_COLLECTION = 'caseMetadata'
const MANUAL_ASSIGNMENT_STATUS = 'needs_manual_assignment'

// Reasons routeCase.js hands to the platform operator rather than the company
// (MANUAL_ASSIGNMENT_AUDIENCE in functions/src/intake/routeCase.js).
// 'no_routing_rule' and 'handler_not_designated' are deliberately not here -
// those two are the company's own configuration gap and are resolved on
// RoutingRulesPage (COMPANY_ADMIN_ROUTING_REASONS below).
const SUPER_ADMIN_ROUTING_REASONS = ['conflict_of_interest', 'missing_company_id']

// The Company Admin queue's two reasons, mirrored from
// MANUAL_ASSIGNMENT_AUDIENCE in functions/src/intake/routeCase.js and the
// matching disjuncts in the caseMetadata firestore.rules entry - both route
// to companyAdmin because both are the company's own configuration gap
// (a missing routing rule, or a rule pointing at an undesignated handler)
// rather than anything only the platform operator should see.
const COMPANY_ADMIN_ROUTING_REASONS = ['no_routing_rule', 'handler_not_designated']

// Both queue readers below go through caseMetadata/{caseId}, the metadata-only
// mirror the HR Coordinator dashboard uses, never cases/{caseId} - and
// firestore.rules narrows each role's read of that mirror to exactly the
// status + routingReason combination it is allowed to act on. The where()
// clauses are therefore not client-side filtering: drop one and the query is
// denied outright.
//
// Rows are built field by field rather than by spreading the document, the
// same explicit-allowlist habit pickMetadata() follows in
// functions/src/intake/syncCaseMetadata.js - a field added to the mirror later
// does not silently start appearing in either view.
function toQueueRow(d) {
  const data = d.data()
  return {
    // The metadata doc id is the Case ID itself (see submitCase.js).
    caseId: d.id,
    companyId: data.companyId ?? null,
    category: data.category ?? null,
    department: data.department ?? null,
    priority: data.priority ?? null,
    routingReason: data.routingReason ?? null,
    createdAt: data.createdAt ?? null,
  }
}

function newestFirst(rows) {
  return rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
}

// The Super Admin queue: conflict-of-interest cases (which the company must
// never resolve itself) plus the missing_company_id system-error fallback.
// Issued as one equality query per reason rather than a single `in` query so
// each one lines up with a matching disjunct in the caseMetadata rule.
export async function listCasesForSuperAdminAssignment() {
  const snapshots = await Promise.all(
    SUPER_ADMIN_ROUTING_REASONS.map((reason) =>
      getDocs(
        query(
          collection(firestore, CASE_METADATA_COLLECTION),
          where('status', '==', MANUAL_ASSIGNMENT_STATUS),
          where('routingReason', '==', reason)
        )
      )
    )
  )
  return newestFirst(snapshots.flatMap((snapshot) => snapshot.docs.map(toQueueRow)))
}

// The Company Admin queue on RoutingRulesPage: this company's cases that
// stalled on a configuration gap the company itself can fix - no rule
// covering their (category, department) bucket, or a rule that points at a
// handler no longer designated. Conflict-of-interest cases can't appear
// here - the rule denies this role any read of them, not just this query.
// One equality query per reason, same as listCasesForSuperAdminAssignment
// above and for the same reason: each has to line up with a matching
// disjunct in the caseMetadata rule.
export async function listCasesMissingRoutingRule(companyId) {
  if (!companyId) return []
  const snapshots = await Promise.all(
    COMPANY_ADMIN_ROUTING_REASONS.map((reason) =>
      getDocs(
        query(
          collection(firestore, CASE_METADATA_COLLECTION),
          where('companyId', '==', companyId),
          where('status', '==', MANUAL_ASSIGNMENT_STATUS),
          where('routingReason', '==', reason)
        )
      )
    )
  )
  return newestFirst(snapshots.flatMap((snapshot) => snapshot.docs.map(toQueueRow)))
}

// Reassigns a case to a different Case Handler - used both for ordinary
// reassignment and to resolve a case routeCase.js sent to
// 'needs_manual_assignment' (missing rule or conflict of interest). Case
// documents are locked down in firestore.rules (no direct client read or
// write), so this always goes through the reassignCase Cloud Function,
// which runs with the Admin SDK.
export async function reassignCase({ caseId, companyId, handlerId, actorId }) {
  if (!caseId || !companyId || !handlerId) {
    throw new Error('caseId, companyId, and handlerId are required')
  }
  const result = await reassignCaseCallable({ caseId, companyId, handlerId, actorId })
  return result.data
}
