import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

const ANALYTICS_SUBCOLLECTION = 'analytics'
const CONSISTENCY_DOC_ID = 'consistency'

// Reads only from companies/{companyId}/analytics/* - the daily-recomputed
// aggregates functions/src/analytics/aggregateCaseAnalytics.js maintains from
// caseMetadata and referenceCases, never cases/{caseId}. firestore.rules
// opens this collection to companyAdmin, hrCoordinator and caseHandler alike
// (see the analytics match block), so this is a direct client read like
// caseMetadataService.js's listCompanyCaseMetadata, not a callable - there is
// no per-handler breakdown in these documents for a rule to gate further.
export async function listAnalyticsTrend(companyId) {
  const snapshot = await getDocs(
    query(collection(firestore, 'companies', companyId, ANALYTICS_SUBCOLLECTION), where('kind', '==', 'trend'))
  )
  return snapshot.docs.map((d) => d.data()).sort((a, b) => (a.period < b.period ? -1 : 1))
}

export async function getConsistencyInsights(companyId) {
  const snapshot = await getDoc(doc(firestore, 'companies', companyId, ANALYTICS_SUBCOLLECTION, CONSISTENCY_DOC_ID))
  return snapshot.exists() ? snapshot.data() : { byCategory: {} }
}

// The one write-adjacent action this service exposes, and it writes nothing
// to Firestore at all - see functions/src/analytics/exportComplianceReport.js,
// which is read/compile only and hands back a short-lived signed URL to a
// freshly rendered PDF, the same shape reportService.js's case-report export
// already returns.
const exportComplianceReportCallable = httpsCallable(functions, 'exportComplianceReport')

export async function exportComplianceReport({ startPeriod, endPeriod } = {}) {
  const result = await exportComplianceReportCallable({ startPeriod, endPeriod })
  return result.data
}

export const CATEGORY_LABELS = {
  harassment: 'Harassment',
  toxicManagement: 'Toxic management',
  retaliation: 'Retaliation',
  burnout: 'Burnout',
}
