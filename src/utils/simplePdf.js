// A hand-built, single-page PDF with no external dependency - the app has no
// PDF library anywhere else, and pulling one in (jsPDF and friends drag in a
// canvas/SVG toolchain) is a lot of surface area for what is a handful of
// lines of plain text. PDF's text-object syntax is simple enough to write
// directly: one page, one font, one content stream.
//
// `lines` is rendered top to bottom, one per line, at 72pt margins on a
// US-Letter page. A line can be a string (regular weight), `{ text, bold }`
// for a heading, `{ text, bold, color }` for a colored heading (Rectifia's
// wordmark uses this), or `{ rule: true }` for a thin horizontal divider.
// `color` is `[r, g, b]` in the 0-1 range PDF's `rg` operator expects.
// Nothing here parses or validates PDF - it only ever emits it, so there is
// no untrusted-input surface to worry about beyond escaping the text itself.
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 72
const LINE_HEIGHT = 20
const FONT_SIZE_REGULAR = 12
const FONT_SIZE_BOLD = 13

// Rectifia navy (--color-navy in index.css), as 0-1 RGB - the one accent
// this generic PDF is allowed to use, since it names Rectifia, not the
// reporting company (see CaseCredentialsHandoff.jsx for why the two are
// kept apart).
export const RECTIFIA_BRAND_COLOR = [0.043, 0.173, 0.286]

function escapePdfText(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function formatColorComponent(value) {
  return Math.min(1, Math.max(0, value)).toFixed(3)
}

function buildContentStream(lines) {
  let y = PAGE_HEIGHT - MARGIN
  const ops = ['BT']
  let currentFont = null
  let coloredText = false

  for (const line of lines) {
    if (line && typeof line === 'object' && line.rule) {
      // A thin filled rectangle, drawn between text blocks - fill/stroke ops
      // aren't valid inside BT/ET, so the text block closes, the rule draws,
      // and a fresh block reopens for whatever follows.
      const ruleColor = line.color ?? [0.85, 0.85, 0.85]
      ops.push('ET')
      ops.push(ruleColor.map(formatColorComponent).join(' ') + ' rg')
      ops.push(`72 ${y - 4} 468 1 re`, 'f')
      ops.push('0 0 0 rg', 'BT')
      currentFont = null
      y -= LINE_HEIGHT
      continue
    }

    const isBold = typeof line === 'object' && line !== null && line.bold
    const text = typeof line === 'object' && line !== null ? line.text : line
    const color = typeof line === 'object' && line !== null ? line.color : null
    const font = isBold ? '/F2' : '/F1'
    const size = isBold ? FONT_SIZE_BOLD : FONT_SIZE_REGULAR

    if (font !== currentFont) {
      ops.push(`${font} ${size} Tf`)
      currentFont = font
    }
    if (color) {
      ops.push(color.map(formatColorComponent).join(' ') + ' rg')
      coloredText = true
    } else if (coloredText) {
      ops.push('0 0 0 rg')
      coloredText = false
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
