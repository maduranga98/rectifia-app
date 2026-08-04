const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
const { recomputeCompanyStats } = require('./computeCompanyStats')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Keeps companies/{companyId}/stats/overview (module 15's Company Admin
// overview) in sync with caseMetadata - the same metadata-only mirror
// syncCaseMetadata.js already maintains for the HR Coordinator dashboard.
// Company Admin still never gets a rules path to caseMetadata itself (see
// firestore.rules); this rollup is the only case-derived surface it reads,
// and it holds counts only, no case content.
exports.syncCompanyStats = onDocumentWritten('caseMetadata/{caseId}', async (event) => {
  const after = event.data.after
  const before = event.data.before
  const companyId = after.exists ? after.data().companyId : before.data()?.companyId

  await recomputeCompanyStats(admin.firestore(), companyId)
})
