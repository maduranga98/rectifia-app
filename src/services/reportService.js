import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const generateReportCallable = httpsCallable(functions, 'generateReport')

// Pure read/compile on the backend (functions/src/intake/generateReport.js)
// - calling this never changes case data, so it's safe to call as often as
// the report view needs, e.g. every time CaseReport.jsx is opened.
export async function generateReport(caseId) {
  const result = await generateReportCallable({ caseId })
  return result.data.report
}
