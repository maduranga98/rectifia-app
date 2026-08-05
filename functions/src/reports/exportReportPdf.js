const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { requireAuthUid } = require('../utils/staffAuth')
const { compileReport } = require('../intake/generateReport')
const { renderReportPdf } = require('./renderReportPdf')
const { encryptionKeySecret, decryptIdentity } = require('../utils/identityVault')

if (!admin.apps.length) {
  admin.initializeApp()
}

const REPORT_PREFIX = 'case-reports'
const REPORT_EXPORTS_COLLECTION = 'reportExports'
const COMPANIES_COLLECTION = 'companies'
// Matches functions/src/utils/evidenceStorage.js's own ceiling and the same
// reasoning: a signed URL is a bearer credential, and this is the maximum
// lifetime given to any of them regardless of what a caller asks for.
const SIGNED_URL_TTL_MINUTES = 15

// Deterministic, order-independent JSON. A plain JSON.stringify(report) would
// hash differently for two calls that built an identical report object with
// keys inserted in a different order - which V8 does not guarantee stays
// fixed across engine versions or refactors of generateReport.js - so this
// sorts object keys recursively before serializing. Arrays keep their order:
// the timeline and evidence lists are sequences, not sets, and their order is
// itself part of the case record.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key])
        return acc
      }, {})
  }
  return value
}

function hashReport(report) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(report))).digest('hex')
}

function hashBytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function lookupCompanyName(firestore, companyId) {
  if (!companyId) return null
  const snapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  return snapshot.exists ? snapshot.data().name ?? null : null
}

// Resolves the Appendix state renderReportPdf.js lays out, from server-side
// facts only - the case's current tier, whether identity was purged (module
// 23), whether anything is on file, and whether THIS export both requested
// and was authorized to include the decrypted value. This is the one place
// exportReportPdf.js is allowed to decrypt: it reuses decryptIdentity() from
// the identity vault directly (the same function revealIdentity.js calls),
// under its own audit action label, rather than inventing a second decrypt
// path or trusting a client-supplied plaintext blob.
async function resolveIdentityAppendix({ firestore, caseData, report, caseId, uid, actorEmail, includeIdentity, reason }) {
  // Never for anonymous-tier - not for any role, not under any request. A
  // case with no `tier` at all predates the field, and reads as anonymous
  // exactly like generateReport.js treats it.
  if (caseData.tier !== 'confidential') {
    return { kind: 'anonymous', includedIdentity: false }
  }

  if (caseData.identityPurgedAt) {
    return { kind: 'purged', purgedAt: caseData.identityPurgedAt?.toMillis?.() ?? null, includedIdentity: false }
  }

  const envelope = caseData.reporterIdentity?.vault ?? null
  if (!envelope) {
    return { kind: 'not_on_file', includedIdentity: false }
  }

  if (!includeIdentity) {
    // On file but not requested for this export - reuses the
    // restrictedReporterIdentity summary compileReport() already produced
    // above rather than compiling a second time, so this sentence matches
    // exactly what CaseReport.jsx shows on screen for the same case.
    return { kind: 'on_file_not_included', restricted: report.restrictedReporterIdentity ?? null, includedIdentity: false }
  }

  // Reaching here means: confidential tier, not purged, an envelope exists,
  // and the caller explicitly asked to include it. Authorization is already
  // established by the time this runs - the caller of exportReportPdf only
  // gets this far via loadCaseForHandler, which is exactly revealIdentity.js's
  // 'assignedHandler' grant (see the comment on exportReportPdf below) - so
  // decryptIdentity() is called with that same authorizedAs value.
  const identity = await decryptIdentity({
    envelope,
    authorizedAs: 'assignedHandler',
    actorUid: uid,
    actorEmail,
    reason,
    caseId,
    field: 'reporterIdentity',
    firestore,
    // Distinct from 'staff_reveal' (revealIdentity.js) and
    // 'reporter_self_reveal' (identityTransition.js) so
    // identityAccessAuditLog can tell "someone read this on screen" apart
    // from "someone put this in a document that just left the system".
    action: 'report_export_reveal',
  })

  return { kind: 'included', identity, includedIdentity: true }
}

// Exports a case's closed-case report as a signed, timestamped PDF. Uses
// EXACTLY the compile logic generateReport.js already runs - no second
// Firestore read of case content, no second serialization of the report
// shape - so the PDF can never say something different from what
// CaseReport.jsx shows on screen for the same case.
//
// Authorization is requireAuthUid + loadCaseForHandler, identical to
// generateReport.js: the assigned handler only, no Super Admin path and no
// new way into a case's content. That is also what makes it safe to trust
// `includeIdentity` below without a second authorization check of its own -
// a caller who reached this point already holds exactly the grant
// revealIdentity.js calls 'assignedHandler'.
//
// Generating a PDF changes nothing about the case: every write below is to
// case-reports/** in Storage or to a new reportExports/{exportId} document, a
// sibling record of the export event, never a mutation of the case, its
// thread, or its status.
exports.exportReportPdf = onCall({ secrets: [encryptionKeySecret], memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, includeIdentity, reason } = request.data || {}

  if (includeIdentity && (typeof reason !== 'string' || reason.trim().length < 10)) {
    throw new HttpsError(
      'invalid-argument',
      'A documented reason of at least 10 characters is required to include reporter identity in an export'
    )
  }

  const firestore = admin.firestore()
  const { report, caseData } = await compileReport(firestore, caseId, uid)

  const companyName = await lookupCompanyName(firestore, caseData.companyId)
  const generatedAt = Date.now()
  const generatedByLabel = request.auth?.token?.email || uid

  const identityAppendix = await resolveIdentityAppendix({
    firestore,
    caseData,
    report,
    caseId,
    uid,
    actorEmail: request.auth?.token?.email ?? null,
    includeIdentity: includeIdentity === true,
    reason,
  })

  // Hashed BEFORE rendering - see the long comment on drawCoverPage in
  // renderReportPdf.js for why this, and not a hash of the finished PDF
  // bytes, is the value printed on the cover.
  const reportContentHash = hashReport(report)

  const { buffer: pdfBytes, pageCount } = await renderReportPdf({
    report,
    companyName,
    generatedAt,
    generatedByLabel,
    reportContentHash,
    identityAppendix,
  })

  const pdfHash = hashBytes(pdfBytes)
  const shortHash = pdfHash.slice(0, 12)
  const storagePath = `${REPORT_PREFIX}/${caseId}/${generatedAt}-${shortHash}.pdf`

  const file = admin.storage().bucket().file(storagePath)
  await file.save(pdfBytes, {
    contentType: 'application/pdf',
    metadata: {
      metadata: {
        caseId,
        contentHash: pdfHash,
        reportContentHash,
      },
    },
  })

  const expiresAt = Date.now() + SIGNED_URL_TTL_MINUTES * 60 * 1000
  const [downloadUrl] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt })

  // Every export is its own audit entry - a PDF is an offline, uncontrolled
  // copy of the most sensitive artifact this system produces, and that event
  // matters exactly as much as an identity decrypt does. This is a sibling
  // write alongside the Storage upload above, never a mutation of the case
  // itself: the case document, its thread, and its status are untouched by
  // generating a report.
  const exportRef = await firestore.collection(REPORT_EXPORTS_COLLECTION).add({
    caseId,
    companyId: caseData.companyId ?? null,
    exportedByUid: uid,
    exportedAt: admin.firestore.FieldValue.serverTimestamp(),
    storagePath,
    // The PDF file's own SHA-256 - what proves THIS delivered file's bytes
    // are what was recorded, matching the field name and value the blueprint
    // schema calls out.
    contentHash: pdfHash,
    // The compiled-report hash, computed before rendering - what proves the
    // underlying case record was unaltered between two exports taken at
    // different times. See canonicalize()/hashReport() above.
    reportContentHash,
    includedIdentity: identityAppendix.includedIdentity === true,
    pageCount,
    sizeBytes: pdfBytes.length,
  })

  return {
    exportId: exportRef.id,
    downloadUrl,
    expiresAt,
    contentHash: pdfHash,
    reportContentHash,
    sizeBytes: pdfBytes.length,
  }
})
