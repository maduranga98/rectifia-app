import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

const generateReportCallable = httpsCallable(functions, 'generateReport')

// Pure read/compile on the backend (functions/src/intake/generateReport.js)
// - calling this never changes case data, so it's safe to call as often as
// the report view needs, e.g. every time CaseReport.jsx is opened.
export async function generateReport(caseId) {
  const result = await generateReportCallable({ caseId })
  return result.data.report
}

const exportReportPdfCallable = httpsCallable(functions, 'exportReportPdf')

const REPORT_EXPORTS_COLLECTION = 'reportExports'

// Renders and hands back a signed URL for this case's closed-case report -
// functions/src/reports/exportReportPdf.js does the actual work; this call
// changes nothing about the case itself, only produces a Storage object and
// a reportExports record describing the export. `includeIdentity` is only
// honoured server-side for a 'confidential'-tier case the caller is
// authorized to see identity for, and requires `reason` (>= 10 characters) -
// see the callable's own comment for why an unauthorized or anonymous-tier
// request is refused rather than silently downgraded.
export async function exportReportPdf(caseId, { includeIdentity = false, reason } = {}) {
  const result = await exportReportPdfCallable({ caseId, includeIdentity, reason })
  return result.data
}

// Read-only history of every export a case's report has gone through - who,
// when, whether identity was included, how big the file was. firestore.rules
// scopes this to the case's own assigned handler or that company's Company
// Admin, the same two readers exportReportPdf.js's own authorization allows,
// so there's no query here that widens on what the rules already enforce.
export async function listReportExports(caseId) {
  const snapshot = await getDocs(
    query(
      collection(firestore, REPORT_EXPORTS_COLLECTION),
      where('caseId', '==', caseId),
      orderBy('exportedAt', 'desc')
    )
  )
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}
