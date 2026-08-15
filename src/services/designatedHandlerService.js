import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, firestore, functions } from './firebase'

const COMPANIES_COLLECTION = 'companies'
const DESIGNATED_HANDLERS_SUBCOLLECTION = 'designatedHandlers'

const designateHandlerCallable = httpsCallable(functions, 'designateHandler')
const revokeHandlerDesignationCallable = httpsCallable(functions, 'revokeHandlerDesignation')
const acknowledgeConfidentialityCallable = httpsCallable(functions, 'acknowledgeConfidentiality')

// Mirrors CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT in
// functions/src/compliance/designatedHandlers.js, purely so a handler can be
// shown the exact wording before they accept it - the server is the only
// place that actually writes it onto the record (acknowledgeConfidentiality),
// so a drift here can change what the UI displays but never what gets
// written or what a handler agreed to. Pending review by employment counsel,
// same as the server-side copy - this is an engineering default, not legal
// advice.
export const CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT =
  "I acknowledge that I have been designated a 従事者 (designated handler) under Japan's " +
  'Whistleblower Protection Act (Act No. 122 of 2004, as amended 2022). I understand that ' +
  'I am legally obligated to keep confidential any information that could identify a person ' +
  'who has made a whistleblowing report, that this obligation applies to information I obtain ' +
  'in the course of my duties as a designated handler, and that unauthorized disclosure of a ' +
  "reporter's identity may carry criminal penalty under the Act. I accept this obligation."

// companies/{companyId}/designatedHandlers is readable by any staff of the
// company (firestore.rules) - a handler needs to see their own status, and
// this page needs to list the whole register - so these are plain reads,
// same tradeoff as routingService.js's listRoutingRules/listStaff. All
// writes go through the three callables below, run with the Admin SDK.
export async function listDesignatedHandlers(companyId) {
  const snapshot = await getDocs(
    collection(firestore, COMPANIES_COLLECTION, companyId, DESIGNATED_HANDLERS_SUBCOLLECTION)
  )
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// The signed-in caller's own designation record, or null if they have never
// been designated. Used by the self-acknowledgment view - never takes a uid
// parameter, since a handler can only ever be shown their own record here.
export async function getMyDesignation(companyId) {
  const uid = auth.currentUser?.uid
  if (!uid) return null
  const snapshot = await getDoc(
    doc(firestore, COMPANIES_COLLECTION, companyId, DESIGNATED_HANDLERS_SUBCOLLECTION, uid)
  )
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
}

export async function designateHandler(companyId, staffUid) {
  if (!companyId || !staffUid) {
    throw new Error('companyId and staffUid are required')
  }
  const result = await designateHandlerCallable({ companyId, staffUid })
  return result.data
}

export async function revokeHandlerDesignation(companyId, staffUid, reason) {
  if (!companyId || !staffUid) {
    throw new Error('companyId and staffUid are required')
  }
  const result = await revokeHandlerDesignationCallable({ companyId, staffUid, reason })
  return result.data
}

// Self-served only - the callable takes no staffUid at all and always acts
// on the authenticated caller's own uid, so there is nothing for this
// wrapper to pass beyond companyId.
export async function acknowledgeConfidentiality(companyId) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  const result = await acknowledgeConfidentialityCallable({ companyId })
  return result.data
}
