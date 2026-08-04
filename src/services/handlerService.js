import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, firestore, functions } from './firebase'

const CASES_COLLECTION = 'cases'

const proposeActionCallable = httpsCallable(functions, 'proposeAction')
const closeCaseCallable = httpsCallable(functions, 'closeCase')

export const ACTION_CATEGORIES = [
  'no_action',
  'coaching',
  'verbal_warning',
  'written_warning',
  'performance_improvement_plan',
  'suspension',
  'demotion',
  'termination',
]

function requireHandlerUid() {
  const uid = auth.currentUser?.uid
  if (!uid) {
    throw new Error('You must be signed in as a Case Handler to view this')
  }
  return uid
}

function serializeCase(docSnapshot) {
  return { id: docSnapshot.id, ...docSnapshot.data() }
}

// One of the few places the client reads cases/{caseId} directly rather
// than through a callable - firestore.rules only allows it when
// resource.data.assignedHandlerId matches the caller's auth uid, so this
// query can never return another handler's cases even if the UI's own
// filtering were bypassed.
export async function listAssignedCases() {
  const uid = requireHandlerUid()
  const snapshot = await getDocs(
    query(collection(firestore, CASES_COLLECTION), where('assignedHandlerId', '==', uid))
  )
  return snapshot.docs.map(serializeCase)
}

// Same rule applies to a single-doc read: it only succeeds if this case is
// assigned to the signed-in handler, otherwise Firestore denies it outright
// - not just a client-side check the UI could get wrong.
export async function getAssignedCase(caseId) {
  const snapshot = await getDoc(doc(firestore, CASES_COLLECTION, caseId))
  if (!snapshot.exists()) return null
  return serializeCase(snapshot)
}

// Proposing an action is what starts module 10's consistency check running
// (see functions/src/investigation/caseActions.js) - it does not close the
// case by itself.
export async function proposeAction(caseId, { actionCategory, notes, effectiveDate }) {
  // Guard the UX for a signed-out user; the caller's identity itself is
  // taken server-side from the ID token the callable attaches automatically,
  // so no investigatorId is sent in the payload.
  requireHandlerUid()
  const result = await proposeActionCallable({ caseId, actionCategory, notes, effectiveDate })
  return result.data
}

// Fails with 'failed-precondition' until the consistency check has finished
// running against the current proposed action - callers should surface that
// as "still checking, try again shortly" rather than a hard error.
export async function closeCase(caseId) {
  requireHandlerUid()
  const result = await closeCaseCallable({ caseId })
  return result.data
}
