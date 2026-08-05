const PDFDocument = require('pdfkit')

// Fixed, unconfigurable per the blueprint - this text never comes from a
// company setting or a caller-supplied field, and it is stamped on every
// page (cover and footer both), not just the first one, so a page separated
// from the rest of the bundle still announces what it is.
const CLASSIFICATION_BANNER = 'CONFIDENTIAL — INTERNAL INVESTIGATION RECORD'

// pdfkit's Base-14 fonts ("Helvetica", "Helvetica-Bold", ...) are not read
// from the host OS - they are standard PDF fonts whose metrics are part of
// the PDF specification itself, so every conformant reader renders them
// identically without this file shipping or embedding a font binary. That is
// the "pdfkit's standard fonts" branch the blueprint explicitly allows as an
// alternative to bundling Inter, and it is what this module uses: no font
// file to source, license, or keep in sync, and no dependency on whatever
// fonts happen to be installed on the machine running the Cloud Function.
const FONT_REGULAR = 'Helvetica'
const FONT_BOLD = 'Helvetica-Bold'
const FONT_ITALIC = 'Helvetica-Oblique'
const FONT_MONO = 'Courier'

const COLORS = {
  ink: '#1a1f2b',
  muted: '#5b6472',
  line: '#c7ccd6',
  band: '#f2f4f7',
  classification: '#9a1c1c',
  logAccent: '#b45309',
}

const PAGE_MARGIN = 50
// Reserved band at the bottom of every page for the footer, kept out of the
// normal content-flow area by folding it into the document's bottom margin -
// see drawFooter for why it is temporarily zeroed out again when the footer
// itself is drawn into that band.
const FOOTER_HEIGHT = 34

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

function humanizeFieldName(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

// Deterministic and timezone-independent - the same case renders the same
// timestamp text no matter where the Cloud Function instance happens to run
// or what locale it defaults to. That determinism is part of what makes the
// document reproducible evidence rather than a browser's best guess.
function formatTimestamp(ms) {
  if (!ms) return '—'
  const iso = new Date(ms).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

function formatBytes(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right
}

// Forces a page break before the next write if it would land inside (or
// past) the reserved footer band, so a section header or a table row is
// never split awkwardly across the boundary.
function ensureRoom(doc, height) {
  const bottom = doc.page.height - doc.page.margins.bottom
  if (doc.y + height > bottom) {
    doc.addPage()
  }
}

function sectionHeading(doc, title) {
  ensureRoom(doc, 44)
  doc.moveDown(0.9)
  const width = contentWidth(doc)
  doc.font(FONT_BOLD).fontSize(13).fillColor(COLORS.ink).text(title, { width })
  doc
    .moveTo(doc.page.margins.left, doc.y + 3)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 3)
    .strokeColor(COLORS.line)
    .lineWidth(1)
    .stroke()
  doc.moveDown(0.7)
  doc.font(FONT_REGULAR).fontSize(10).fillColor(COLORS.ink)
}

function emptyState(doc, text) {
  ensureRoom(doc, 20)
  doc.font(FONT_ITALIC).fontSize(10).fillColor(COLORS.muted).text(text, { width: contentWidth(doc) })
  doc.moveDown(0.5)
}

// One label/value row, measured before it is drawn so ensureRoom can decide
// whether it fits on the current page - the same measure-then-draw approach
// used throughout this module so a 400-message case paginates cleanly
// instead of PDFKit silently overflowing content past the page edge.
function keyValue(doc, label, value, { font = FONT_REGULAR, color = COLORS.ink } = {}) {
  const width = contentWidth(doc)
  const text = value === null || value === undefined || value === '' ? '—' : String(value)

  doc.font(FONT_BOLD).fontSize(8.5)
  const labelHeight = doc.heightOfString(label.toUpperCase(), { width })
  doc.font(font).fontSize(10)
  const valueHeight = doc.heightOfString(text, { width })

  ensureRoom(doc, labelHeight + valueHeight + 10)

  doc.font(FONT_BOLD).fontSize(8.5).fillColor(COLORS.muted).text(label.toUpperCase(), { width })
  doc.font(font).fontSize(10).fillColor(color).text(text, { width })
  doc.moveDown(0.5)
}

function drawCoverPage(doc, { report, companyName, generatedAt, generatedByLabel, reportContentHash }) {
  const width = contentWidth(doc)

  doc.moveDown(2.2)
  doc
    .font(FONT_BOLD)
    .fontSize(10)
    .fillColor(COLORS.classification)
    .text(CLASSIFICATION_BANNER, { align: 'center', width })
  doc.moveDown(2.4)

  doc.font(FONT_BOLD).fontSize(21).fillColor(COLORS.ink).text(companyName || 'Rectifia', { align: 'center', width })
  doc.moveDown(0.3)
  doc
    .font(FONT_REGULAR)
    .fontSize(13)
    .fillColor(COLORS.muted)
    .text('Closed-Case Investigation Report', { align: 'center', width })
  doc.moveDown(2.6)

  const rows = [
    ['Case ID', report.caseId],
    ['Category', humanize(report.summary?.category)],
    ['Status', humanize(report.summary?.status)],
    ['Opened', formatTimestamp(report.summary?.createdAt)],
    ['Closed', formatTimestamp(report.summary?.closedAt)],
    ['Generated', formatTimestamp(generatedAt)],
    ['Generated by', generatedByLabel || 'Unknown'],
  ]

  rows.forEach(([label, value]) => {
    doc.font(FONT_BOLD).fontSize(9).fillColor(COLORS.muted).text(label, { width })
    doc.font(FONT_REGULAR).fontSize(11).fillColor(COLORS.ink).text(value ?? '—', { width })
    doc.moveDown(0.55)
  })

  // The content hash printed here is the hash of the COMPILED REPORT OBJECT,
  // taken before any of it was laid out into PDF bytes - not the hash of the
  // PDF file itself. The two are deliberately different things:
  //
  // The PDF's own byte hash cannot be known until rendering is finished, and
  // printing it on the cover would mean printing a hash of a file that, once
  // printed, is no longer the file that was hashed - a self-reference this
  // format cannot resolve, since changing the cover to add the hash changes
  // the bytes the hash was computed over. exportReportPdf.js still computes
  // that PDF-bytes hash (it is what names the Storage object and what
  // reportExports.contentHash records), but it belongs to the file, not
  // inside the file.
  //
  // The report-object hash below has no such problem: it is fixed before
  // rendering starts, so it is exactly reproducible, and it answers the
  // question that actually matters to a reader holding two exports of the
  // same case taken minutes or months apart - "is the underlying case
  // record identical, regardless of when each copy was generated?" - which
  // a PDF-bytes hash could never answer, since two renders of an unchanged
  // case differ in their generation timestamp alone.
  doc.font(FONT_BOLD).fontSize(9).fillColor(COLORS.muted).text('Report Content Hash (SHA-256)', { width })
  doc.font(FONT_MONO).fontSize(9).fillColor(COLORS.ink).text(reportContentHash || '—', { width })
  doc.moveDown(0.3)
  doc
    .font(FONT_ITALIC)
    .fontSize(8)
    .fillColor(COLORS.muted)
    .text(
      'Hash of the compiled case record used to generate this document, computed before layout. Two exports of an unchanged case carry the same hash regardless of when each was generated.',
      { width }
    )
}

function drawSummarySection(doc, report) {
  sectionHeading(doc, '1. Case Summary')
  const summary = report.summary || {}
  keyValue(doc, 'Category', humanize(summary.category))
  keyValue(doc, 'Status', humanize(summary.status))
  keyValue(doc, 'Priority', humanize(summary.priority))
  keyValue(doc, 'Opened', formatTimestamp(summary.createdAt))
  keyValue(doc, 'Closed', formatTimestamp(summary.closedAt))
  // Reported as the two independent numbers they are - never averaged,
  // weighted, or otherwise combined into a single figure. See
  // functions/src/intake/scoreCase.js for why: severity measures the conduct,
  // evidence measures how well-substantiated the account is, and collapsing
  // them would erase exactly the distinction a reader needs.
  keyValue(doc, 'Severity Score', summary.severityScore ?? '—')
  keyValue(doc, 'Evidence Score', summary.evidenceScore ?? '—')
}

function drawQuestionnaireSection(doc, report) {
  sectionHeading(doc, '2. Questionnaire Answers')
  const questionnaire = report.questionnaire || []
  if (questionnaire.length === 0) {
    emptyState(doc, 'No questionnaire responses are on file for this case.')
    return
  }
  questionnaire.forEach((entry) => {
    keyValue(doc, entry.questionText, entry.answer)
  })
}

const SENDER_LABELS = {
  reporter: 'Reporter',
  investigator: 'Case Handler',
  ai: 'AI assistant',
  system: 'System',
}

function messageHeaderLabel(message) {
  if (message.type === 'manual_log') return 'Investigator log'
  return SENDER_LABELS[message.sender] ?? message.sender ?? 'Unknown'
}

function drawMessage(doc, message) {
  const width = contentWidth(doc)
  const isLog = message.type === 'manual_log'
  const indent = isLog ? 12 : 0
  const textWidth = width - indent

  const headerText = `${messageHeaderLabel(message)}  ·  ${message.type ?? 'message'}  ·  ${formatTimestamp(
    message.timestamp
  )}`
  let bodyText = message.text?.trim() || '(no text)'
  const attachmentCount = Array.isArray(message.attachments) ? message.attachments.length : 0
  if (attachmentCount > 0) {
    bodyText += `\n[${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} — see Section 4, Evidence Manifest]`
  }

  doc.font(FONT_BOLD).fontSize(8.5)
  const headerHeight = doc.heightOfString(headerText, { width: textWidth })
  doc.font(isLog ? FONT_ITALIC : FONT_REGULAR).fontSize(10)
  const bodyHeight = doc.heightOfString(bodyText, { width: textWidth })
  const totalHeight = headerHeight + bodyHeight + 16

  ensureRoom(doc, totalHeight)
  const startY = doc.y

  // manual_log entries get the same visually-distinct left accent bar
  // CaseReport.jsx gives them on screen (its 'tone-high' badge), so a reader
  // moving between the app and the PDF recognizes the same entries as
  // investigator-authored rather than part of the reporter/AI/system thread.
  if (isLog) {
    doc.save()
    doc.rect(doc.page.margins.left, startY, 3, totalHeight - 8).fill(COLORS.logAccent)
    doc.restore()
  }

  const textX = doc.page.margins.left + indent
  doc.font(FONT_BOLD).fontSize(8.5).fillColor(COLORS.muted).text(headerText, textX, startY, { width: textWidth })
  doc
    .font(isLog ? FONT_ITALIC : FONT_REGULAR)
    .fontSize(10)
    .fillColor(COLORS.ink)
    .text(bodyText, textX, doc.y, { width: textWidth })
  doc.moveDown(0.7)
}

function drawTimelineSection(doc, report) {
  sectionHeading(doc, '3. Message Timeline')
  const timeline = report.timeline || []
  if (timeline.length === 0) {
    emptyState(doc, 'No messages.')
    return
  }
  timeline.forEach((message) => drawMessage(doc, message))
}

function drawEvidenceSection(doc, report) {
  sectionHeading(doc, '4. Evidence Manifest')
  doc
    .font(FONT_ITALIC)
    .fontSize(8.5)
    .fillColor(COLORS.muted)
    .text(
      'Metadata only - no download links are included. A signed URL expires within minutes of being issued, so a live link printed here would be dead on arrival for any reader who opens this document later than that; evidence is opened from within the app via a freshly issued, audited link instead.',
      { width: contentWidth(doc) }
    )
  doc.moveDown(0.5)

  const evidence = report.evidence || []
  if (evidence.length === 0) {
    emptyState(doc, 'No attachments.')
    return
  }

  const width = contentWidth(doc)
  evidence.forEach((item, index) => {
    const label = item.label ?? item.fileName ?? `Attachment ${index + 1}`
    const line1 = `${index + 1}. ${label}`
    const line2 = `${item.contentType ?? 'unknown type'}  ·  ${formatBytes(item.sizeBytes)}  ·  uploaded ${formatTimestamp(
      item.uploadedAt ?? item.postedAt
    )} by ${item.postedBy ?? 'unknown'}`

    doc.font(FONT_REGULAR).fontSize(10)
    const h1 = doc.heightOfString(line1, { width })
    doc.font(FONT_REGULAR).fontSize(8.5)
    const h2 = doc.heightOfString(line2, { width })

    ensureRoom(doc, h1 + h2 + 10)
    doc.font(FONT_REGULAR).fontSize(10).fillColor(COLORS.ink).text(line1, { width })
    doc.font(FONT_REGULAR).fontSize(8.5).fillColor(COLORS.muted).text(line2, { width })
    doc.moveDown(0.45)
  })
}

function drawConsistencySection(doc, report) {
  sectionHeading(doc, '5. Consistency Flags & Acknowledgement')
  const check = report.consistencyCheck
  if (!check) {
    emptyState(doc, 'No consistency check has run for this case.')
    return
  }
  keyValue(doc, 'Status', humanize(check.status))
  keyValue(doc, 'Flag', check.flag?.message ?? 'None')
  keyValue(doc, 'Typical Action (Reference Cases)', humanize(check.typicalAction))
  keyValue(doc, 'Investigator Acknowledgement Notes', check.resolutionNotes)
  keyValue(doc, 'Checked', formatTimestamp(check.checkedAt))
}

function drawComplianceSection(doc, report) {
  sectionHeading(doc, '6. Compliance Deadline Log')
  const log = report.complianceDeadlineLog || {}
  keyValue(doc, 'Rule Applied', log.complianceRuleApplied)
  keyValue(doc, 'Acknowledgment Due', formatTimestamp(log.acknowledgmentDueAt))
  keyValue(doc, 'Acknowledgment Sent', formatTimestamp(log.acknowledgmentSentAt))
  keyValue(doc, 'Feedback Due', formatTimestamp(log.feedbackDueAt))
  keyValue(doc, 'Feedback Given', formatTimestamp(log.feedbackGivenAt))
}

function drawFinalActionSection(doc, report) {
  sectionHeading(doc, '7. Final Action Taken')
  const action = report.finalAction || {}
  keyValue(doc, 'Action', humanize(action.actionTaken ?? action.proposedAction) ?? 'Not yet decided')
  keyValue(doc, 'Effective Date', formatTimestamp(action.actionEffectiveDate))
  keyValue(doc, 'Notes', action.actionNotes)
}

function drawPolicySection(doc, report) {
  sectionHeading(doc, '8. Policy In Effect')
  const policies = report.policyInEffect || []
  if (policies.length === 0) {
    emptyState(doc, "No company policy was in effect for this case's category when it was created.")
    return
  }
  policies.forEach((policy) => {
    const line = `${policy.title ?? 'Policy document'}${policy.version != null ? ` — version ${policy.version}` : ''}`
    ensureRoom(doc, 18)
    doc.font(FONT_REGULAR).fontSize(10).fillColor(COLORS.ink).text(line, { width: contentWidth(doc) })
    doc.moveDown(0.35)
  })
}

// Always renders - never silently omitted - so a reader can always tell "this
// case was anonymous" or "this identity was purged" from "this page is
// missing". `appendix.kind` is resolved by exportReportPdf.js from the
// case's tier, its purge state, and whether the caller was both authorized
// and asked to include the decrypted identity; this function only lays out
// whichever of those states it is handed.
function drawIdentityAppendix(doc, appendix) {
  sectionHeading(doc, 'Appendix — Reporter Identity')
  const width = contentWidth(doc)
  const kind = appendix?.kind ?? 'anonymous'

  if (kind === 'anonymous') {
    doc
      .font(FONT_ITALIC)
      .fontSize(10)
      .fillColor(COLORS.muted)
      .text('This case was filed anonymously. No reporter identity exists in this system for this case.', { width })
    return
  }

  if (kind === 'not_on_file') {
    doc
      .font(FONT_ITALIC)
      .fontSize(10)
      .fillColor(COLORS.muted)
      .text('This case is confidential tier, but no reporter identity was ever recorded for it.', { width })
    return
  }

  if (kind === 'purged') {
    const when = appendix.purgedAt ? ` on ${formatTimestamp(appendix.purgedAt)}` : ''
    doc
      .font(FONT_ITALIC)
      .fontSize(10)
      .fillColor(COLORS.muted)
      .text(
        `Reporter identity was on file for this case but was purged under this company's data retention policy${when}. It cannot be recovered and is not included in this export.`,
        { width }
      )
    return
  }

  if (kind === 'on_file_not_included') {
    keyValue(doc, 'Status', appendix.restricted?.status)
    keyValue(doc, 'Details On File', appendix.restricted?.detailsOnFile)
    doc
      .font(FONT_ITALIC)
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text('Reporter identity was not decrypted or included in this export.', { width })
    return
  }

  if (kind === 'included') {
    keyValue(doc, 'Status', 'Included in this export under logged, authorized decryption.')
    Object.entries(appendix.identity || {}).forEach(([field, value]) => {
      keyValue(doc, humanizeFieldName(field), typeof value === 'object' ? JSON.stringify(value) : value)
    })
    return
  }

  doc
    .font(FONT_ITALIC)
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text('Reporter identity status could not be determined for this export.', { width })
}

// Drawn last, on every buffered page, after all section content exists - see
// the caller for why margins.bottom is temporarily zeroed for this call.
// PDFKit's automatic pagination triggers whenever a write would land past
// page.height - margins.bottom; writing the footer INTO that reserved band
// would otherwise make PDFKit believe the page has already overflowed and
// insert a spurious blank page before the footer's own text.
function drawFooter(doc, { caseId, pageNumber, pageCount }) {
  const left = doc.page.margins.left
  const right = doc.page.margins.right
  const width = doc.page.width - left - right
  const footerTop = doc.page.height - PAGE_MARGIN - FOOTER_HEIGHT

  doc
    .moveTo(left, footerTop)
    .lineTo(doc.page.width - right, footerTop)
    .strokeColor(COLORS.line)
    .lineWidth(0.5)
    .stroke()

  doc
    .font(FONT_BOLD)
    .fontSize(7.5)
    .fillColor(COLORS.classification)
    .text(CLASSIFICATION_BANNER, left, footerTop + 7, { width, align: 'center' })

  doc
    .font(FONT_REGULAR)
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(`Case ${caseId}`, left, footerTop + 18, { width: width / 2, align: 'left' })
  doc
    .font(FONT_REGULAR)
    .fontSize(7.5)
    .fillColor(COLORS.muted)
    .text(`Page ${pageNumber} of ${pageCount}`, left + width / 2, footerTop + 18, { width: width / 2, align: 'right' })
}

// Renders the closed-case report as PDF bytes. Takes exactly the object
// generateReport.js compiles (`report`) plus rendering-only metadata that is
// never part of that object - who exported it, when, the company's display
// name, the pre-render hash of the report, and the resolved state of the
// identity appendix. Nothing here re-reads Firestore, re-derives case data,
// or diverges from what generateReport.js already computed: this module's
// only job is layout. Resolves { buffer, pageCount }.
async function renderReportPdf({ report, companyName, generatedAt, generatedByLabel, reportContentHash, identityAppendix }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: PAGE_MARGIN,
          bottom: PAGE_MARGIN + FOOTER_HEIGHT,
          left: PAGE_MARGIN,
          right: PAGE_MARGIN,
        },
        bufferPages: true,
        info: {
          Title: `Case Report — ${report.caseId}`,
          Subject: CLASSIFICATION_BANNER,
          Author: companyName || 'Rectifia',
        },
      })

      const chunks = []
      let pageCount = 0
      doc.on('data', (chunk) => chunks.push(chunk))
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pageCount }))
      doc.on('error', reject)

      doc.font(FONT_REGULAR)

      drawCoverPage(doc, { report, companyName, generatedAt, generatedByLabel, reportContentHash })

      doc.addPage()
      drawSummarySection(doc, report)
      drawQuestionnaireSection(doc, report)
      drawTimelineSection(doc, report)
      drawEvidenceSection(doc, report)
      drawConsistencySection(doc, report)
      drawComplianceSection(doc, report)
      drawFinalActionSection(doc, report)
      drawPolicySection(doc, report)
      drawIdentityAppendix(doc, identityAppendix)

      // Page count is only known once every section has been laid out, so
      // the "page N of M" footer has to be a second pass over the buffered
      // pages rather than something drawn inline as content is written.
      const range = doc.bufferedPageRange()
      pageCount = range.count
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i)
        const savedBottom = doc.page.margins.bottom
        doc.page.margins.bottom = 0
        drawFooter(doc, { caseId: report.caseId, pageNumber: i - range.start + 1, pageCount: range.count })
        doc.page.margins.bottom = savedBottom
      }

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

module.exports = { renderReportPdf, CLASSIFICATION_BANNER }
