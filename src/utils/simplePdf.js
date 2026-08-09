// A hand-built, single-page PDF with no external dependency - the app has no
// PDF library anywhere else, and pulling one in (jsPDF and friends drag in a
// canvas/SVG toolchain) is a lot of surface area for what is a handful of
// lines of plain text. PDF's text-object syntax is simple enough to write
// directly: one page, one font, one content stream.
//
// `lines` is rendered top to bottom, one per line, at 72pt margins on a
// US-Letter page. A line can be a string (regular weight) or
// `{ text, bold }` for a heading. Nothing here parses or validates PDF - it
// only ever emits it, so there is no untrusted-input surface to worry about
// beyond escaping the text itself.
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 72
const LINE_HEIGHT = 20
const FONT_SIZE_REGULAR = 12
const FONT_SIZE_BOLD = 13

function escapePdfText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildContentStream(lines) {
  let y = PAGE_HEIGHT - MARGIN
  const ops = ['BT']
  let currentFont = null

  for (const line of lines) {
    const isBold = typeof line === 'object' && line !== null && line.bold
    const text = typeof line === 'object' && line !== null ? line.text : line
    const font = isBold ? '/F2' : '/F1'
    const size = isBold ? FONT_SIZE_BOLD : FONT_SIZE_REGULAR

    if (font !== currentFont) {
      ops.push(`${font} ${size} Tf`)
      currentFont = font
    }
    ops.push(`72 ${y} Td (${escapePdfText(text ?? '')}) Tj`)
    // Td offsets are relative to the previous Td, not absolute, so the y
    // coordinate itself has to move back to 0 on the x axis each time - the
    // simplest way to keep every line independently positioned is to reset
    // the text matrix from BT's origin instead of chaining relative moves.
    ops.push('ET', 'BT')
    y -= LINE_HEIGHT
  }
  ops.push('ET')
  return ops.join('\n')
}

// Builds the PDF bytes and returns them as a Blob, ready to hand to a
// download link. Kept synchronous and pure - no DOM access - so it can be
// unit tested without a browser.
export function buildSimplePdf(lines) {
  const content = buildContentStream(lines)
  const contentBytes = new TextEncoder().encode(content)

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  return new Blob([pdf], { type: 'application/pdf' })
}

// Downloads the PDF via a throwaway object URL and anchor click, the same
// pattern CaseCredentialsHandoff.jsx uses for its plain-text export.
export function downloadSimplePdf(lines, filename) {
  const blob = buildSimplePdf(lines)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
