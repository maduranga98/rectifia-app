import { doc, getDoc } from 'firebase/firestore'
import { firestore } from './firebase'

// Reads only companies/{companyId}/stats/overview - the count-only rollup
// functions/src/company/syncCompanyStats.js maintains from caseMetadata.
// firestore.rules grants Company Admin a read path to this doc and nothing
// else case-derived (not cases/, not messages/, not caseMetadata/ itself).
export async function getCompanyStats(companyId) {
  const snapshot = await getDoc(doc(firestore, 'companies', companyId, 'stats', 'overview'))
  return snapshot.exists() ? snapshot.data() : null
}
