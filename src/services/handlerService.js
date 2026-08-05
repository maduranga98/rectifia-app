import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, firestore, functions } from './firebase'

const CASES_COLLECTION = 'cases'

const proposeActionCallable = httpsCallable(functions, 'proposeAction')
const closeCaseCallable = httpsCallable(functions, 'closeCase')
const reviewConsistencyFlagCallable = httpsCallable(functions, 'reviewConsistencyFlag')
const revealIdentityCallable = httpsCallable(functions, 'revealIdentity')

// Mirrors MIN_REASON_LENGTH in functions/src/utils/identityVault.js. Duplicated
// rather than imported (that is server-only Cloud Functions code) purely to
// gate the reveal button and message the requirement; the server enforces the
// real check, so a drift here can change the copy but never weaken the control.
export const MIN_REASON_LENGTH = 10

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

// Acknowledges module 10's consistency flag with a short note. This only
// records that the handler saw and considered the flag (stored on
// consistencyCheck.flag.reviewedBy/reviewNote/reviewedAt server-side) - it
// never changes or unblocks their proposed action or the case status.
export async function reviewConsistencyFlag(caseId, note) {
  requireHandlerUid()
  const result = await reviewConsistencyFlagCallable({ caseId, note })
  return result.data
}

// Reveals a confidential reporter's identity on a case the caller is entitled
// to (the assigned handler, or a Super Admin - resolved and enforced entirely
// server-side by functions/src/investigation/revealIdentity.js). The reason is
// required and logged; there is no way to decrypt without one. The plaintext
// comes back only in this response - it is never written to the case or any
// log - so the caller holds it in memory for the session and re-requests it
// (with a fresh reason) if it needs it again. Returns { field, identity }.
export async function revealReporterIdentity(caseId, reason) {
  requireHandlerUid()
  const result = await revealIdentityCallable({ caseId, field: 'reporterIdentity', reason })
  return result.data
}
