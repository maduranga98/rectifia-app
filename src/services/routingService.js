import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
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
