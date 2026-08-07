const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { trailingPeriods } = require('./aggregateCaseAnalytics')
const { TREND_WINDOW_MONTHS } = require('./analyticsThresholds')
const { renderComplianceReportPdf } = require('./renderComplianceReportPdf')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const ANALYTICS_SUBCOLLECTION = 'analytics'
const CONSISTENCY_DOC_ID = 'consistency'
const REPORT_PREFIX = 'compliance-reports'
const SIGNED_URL_TTL_MINUTES = 15
const PERIOD_PATTERN = /^\d{4}-\d{2}$/

// Board/audit report generation is deliberately narrower than dashboard
// viewing: AnalyticsDashboard.jsx is readable by companyAdmin, hrCoordinator
// AND caseHandler (see the analytics rules match block), but compiling the
// exportable PDF that leaves the system as a standalone file is restricted to
// the two roles whose job actually includes handing a document to a board
// member or an auditor. A Case Handler can see the same aggregate numbers on
// screen; it has no reason to mint an offline copy of them.
const EXPORT_ROLES = ['companyAdmin', 'hrCoordinator']

async function lookupCompanyName(firestore, companyId) {
  const snapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  return snapshot.exists ? snapshot.data().name ?? null : null
}

// Merges the already-suppressed per-period breakdowns into one range total.
// This is deliberately conservative, not a re-aggregation from raw rows: a
// category with 2 cases in each of three periods (6 total, above the floor)
// still never appears here, because each period independently withheld it
// below MIN_AGGREGATE_CASES before this module ever saw it. That
// under-reports occasionally but never over-exposes - the report has no read
// path to the raw rows that would let it recompute a truer total safely.
function mergeCounts(periods, field) {
  const totals = {}
  for (const period of periods) {
    for (const [key, count] of Object.entries(period[field] || {})) {
      totals[key] = (totals[key] ?? 0) + count
    }
  }
  return totals
}

// Compiles the aggregate report object from companies/{companyId}/analytics/*
// - the trend documents aggregateCaseAnalytics.js already computed, over the
// caller-selected period range, plus the single consistency summary doc. This
// function issues Firestore reads only; it writes nothing back to
// caseMetadata, referenceCases, or cases at any point, matching Module 12's
// CaseReport constraint that report generation never alters underlying data.
async function compileComplianceReport(firestore, companyId, { startPeriod, endPeriod }) {
  const availablePeriods = trailingPeriods(Date.now(), TREND_WINDOW_MONTHS)

  let rangePeriods = availablePeriods
  if (startPeriod || endPeriod) {
    const start = startPeriod ?? availablePeriods[0]
    const end = endPeriod ?? availablePeriods[availablePeriods.length - 1]
    if (!PERIOD_PATTERN.test(start) || !PERIOD_PATTERN.test(end)) {
      throw new HttpsError('invalid-argument', 'startPeriod and endPeriod must be YYYY-MM')
    }
    const startIndex = availablePeriods.indexOf(start)
    const endIndex = availablePeriods.indexOf(end)
    if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
      // Only the trailing window aggregateCaseAnalytics.js actually keeps
      // documents for is a valid range - anything else has no data behind it,
      // and returning an empty-looking report would read as "no cases" rather
      // than "not a computed period".
      throw new HttpsError('invalid-argument', 'Requested range is outside the computed trend window')
    }
    rangePeriods = availablePeriods.slice(startIndex, endIndex + 1)
  }

  const analyticsCollection = firestore.collection(COMPANIES_COLLECTION).doc(companyId).collection(ANALYTICS_SUBCOLLECTION)
  const refs = rangePeriods.map((p) => analyticsCollection.doc(`trend_${p}`))
  refs.push(analyticsCollection.doc(CONSISTENCY_DOC_ID))
  const snapshots = await firestore.getAll(...refs)

  const consistencySnapshot = snapshots.pop()
  const trend = snapshots.map((snap, i) =>
    snap.exists
      ? snap.data()
      : {
          period: rangePeriods[i],
          caseCount: 0,
          volumeByCategory: {},
          volumeByDepartment: {},
          avgResolutionDays: null,
          compliance: {
            ruleLabel: null,
            acknowledgmentDueDays: null,
            feedbackDueDays: null,
            acknowledgedWithinWindowRate: null,
            resolvedWithinWindowRate: null,
            acknowledgmentSampleSize: 0,
            resolutionSampleSize: 0,
          },
        }
  )

  const consistency = consistencySnapshot.exists ? consistencySnapshot.data() : { byCategory: {} }

  const companyName = await lookupCompanyName(firestore, companyId)

  return {
    companyId,
    companyName,
    range: { startPeriod: rangePeriods[0], endPeriod: rangePeriods[rangePeriods.length - 1] },
    totals: {
      caseCount: trend.reduce((sum, p) => sum + (p.caseCount ?? 0), 0),
      volumeByCategory: mergeCounts(trend, 'volumeByCategory'),
      volumeByDepartment: mergeCounts(trend, 'volumeByDepartment'),
    },
    trend,
    consistency,
  }
}

// Exports a board/audit-ready PDF compiled entirely from this company's own
// companies/{companyId}/analytics/* aggregates. Same posture as
// functions/src/reports/exportReportPdf.js: read/compile only, nothing here
// mutates a case, caseMetadata, or referenceCases, and the only writes are
// the rendered PDF's Storage object and this call's own audit trail entry.
exports.exportComplianceReport = onCall({ memory: '512MiB', timeoutSeconds: 60 }, async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  const companyId = request.auth?.token?.companyId
  if (!companyId || (request.data?.companyId && request.data.companyId !== companyId)) {
    throw new HttpsError('permission-denied', 'You may only export your own company\'s compliance report')
  }

  const role = await loadCallerRole(firestore, companyId, uid, 'compliance_report_export')
  if (!EXPORT_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'compliance_report_export',
      outcome: 'denied:permission-denied',
      detail: 'role_not_export_eligible',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin or HR Coordinator may export the compliance report')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'compliance_report_export', outcome: 'granted' })

  const { startPeriod, endPeriod } = request.data || {}
  const report = await compileComplianceReport(firestore, companyId, { startPeriod, endPeriod })

  const generatedAt = Date.now()
  const generatedByLabel = request.auth?.token?.email || uid
  const { buffer: pdfBytes, pageCount } = await renderComplianceReportPdf({ ...report, generatedAt, generatedByLabel })

  const storagePath = `${REPORT_PREFIX}/${companyId}/${generatedAt}-${report.range.startPeriod}_${report.range.endPeriod}.pdf`
  const file = admin.storage().bucket().file(storagePath)
  await file.save(pdfBytes, {
    contentType: 'application/pdf',
    metadata: { metadata: { companyId, startPeriod: report.range.startPeriod, endPeriod: report.range.endPeriod } },
  })

  const expiresAt = Date.now() + SIGNED_URL_TTL_MINUTES * 60 * 1000
  const [downloadUrl] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt })

  return {
    downloadUrl,
    expiresAt,
    pageCount,
    sizeBytes: pdfBytes.length,
    range: report.range,
  }
})
