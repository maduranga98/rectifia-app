import { collection, getDocs, query, where } from 'firebase/firestore'
import { firestore } from './firebase'

const CASE_METADATA_COLLECTION = 'caseMetadata'

// Reads only from caseMetadata/{caseId}, never cases/{caseId} - the mirror
// functions/src/intake/syncCaseMetadata.js maintains with exactly the fields
// the HR Coordinator dashboard is allowed to see (never `responses` or
// anything from messages/). firestore.rules enforces this same boundary
// server-side (only the hrCoordinator custom claim can read this
// collection), so this service can't be bypassed by calling a different
// query - there is no rules path from this role to the real case doc.
export async function listCompanyCaseMetadata(companyId) {
  const snapshot = await getDocs(
    query(collection(firestore, CASE_METADATA_COLLECTION), where('companyId', '==', companyId))
  )
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}
