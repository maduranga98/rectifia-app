// A hand-built, single-page PDF with no external dependency - the app has no
// PDF library anywhere else, and pulling one in (jsPDF and friends drag in a
// canvas/SVG toolchain) is a lot of surface area for what is a handful of
// lines of plain text plus one small logo image. PDF's text-object syntax is
// simple enough to write directly: one page, one font, one content stream.
//
// `lines` is rendered top to bottom, one per line, at 72pt margins on a
// US-Letter page. A line can be a string (regular weight), `{ text, bold }`
// for a heading, `{ text, bold, color }` for a colored heading (Rectifia's
// wordmark uses this), or `{ rule: true }` for a thin horizontal divider.
// `color` is `[r, g, b]` in the 0-1 range PDF's `rg` operator expects.
// Nothing here parses or validates PDF - it only ever emits it, so there is
// no untrusted-input surface to worry about beyond escaping the text itself.
//
// The logo is drawn as a JPEG XObject (DCTDecode) - JPEG is the one raster
// format that can be embedded in a hand-written PDF without implementing a
// compressor, since the browser's own canvas can produce the JPEG bytes and
// they get copied into the stream unchanged. Because that stream is binary,
// the PDF below is assembled as bytes (Uint8Array), not as one big string -
// a plain string would round-trip through UTF-8 on the way to a Blob and
// corrupt any byte above 0x7f.
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 72
const LINE_HEIGHT = 20
const FONT_SIZE_REGULAR = 12
const FONT_SIZE_BOLD = 13
const LOGO_MAX_WIDTH_PT = 84
const LOGO_TOP_GAP_PT = 18

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

// Loads /logo.png, flattens it onto a white background (JPEG has no alpha
// channel), and hands back the raw JPEG bytes plus pixel dimensions. Returns
// null on any failure - a missing logo should never block downloading the
// PDF, it should just fall back to the text-only wordmark.
export async function loadLogoForPdf() {
  try {
    const response = await fetch('/logo.png')
    if (!response.ok) return null
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!jpegBlob) return null
    const buffer = await jpegBlob.arrayBuffer()
    return { bytes: new Uint8Array(buffer), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

// Small byte-buffer builder: text chunks are encoded as ASCII/UTF-8 (every
// character used elsewhere in this file is plain ASCII, so that's lossless),
// binary chunks (the JPEG stream) are copied through untouched, and the
// whole thing is flattened into one Uint8Array at the end.
class ByteWriter {
  constructor() {
    this.chunks = []
    this.length = 0
  }

  text(str) {
    const bytes = new TextEncoder().encode(str)
    this.chunks.push(bytes)
    this.length += bytes.length
    return this
  }

  bytes(arr) {
    this.chunks.push(arr)
    this.length += arr.length
    return this
  }

  toUint8Array() {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

function buildContentStream(lines, logoLayout) {
  let y = logoLayout ? logoLayout.contentStartY : PAGE_HEIGHT - MARGIN
  const ops = []

  if (logoLayout) {
    ops.push(
      'q',
      `${logoLayout.drawWidth.toFixed(2)} 0 0 ${logoLayout.drawHeight.toFixed(2)} ${logoLayout.x.toFixed(2)} ${logoLayout.y.toFixed(2)} cm`,
      '/Logo Do',
      'Q'
    )
  }

  ops.push('BT')
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

function computeLogoLayout(logo) {
  if (!logo || !logo.width || !logo.height) return null
  const drawWidth = Math.min(LOGO_MAX_WIDTH_PT, logo.width)
  const drawHeight = (logo.height / logo.width) * drawWidth
  const x = MARGIN
  const y = PAGE_HEIGHT - MARGIN - drawHeight
  return {
    drawWidth,
    drawHeight,
    x,
    y,
    contentStartY: y - LOGO_TOP_GAP_PT,
  }
}

// Builds the PDF bytes and returns them as a Blob, ready to hand to a
// download link. `logo`, if supplied, is the return value of
// `loadLogoForPdf()`. Kept free of DOM access beyond what's already baked
// into `logo` so the byte-assembly itself stays easy to reason about.
export function buildSimplePdf(lines, logo = null) {
  const logoLayout = computeLogoLayout(logo)
  const content = buildContentStream(lines, logoLayout)
  const contentBytes = new TextEncoder().encode(content)

  const pageResources = logoLayout
    ? `<< /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Logo 7 0 R >> >>`
    : `<< /Font << /F1 4 0 R /F2 5 0 R >> >>`

  const writer = new ByteWriter()
  writer.text('%PDF-1.4\n')

  const offsets = [0]
  const objectCount = logoLayout ? 7 : 6

  function beginObject(index) {
    offsets[index] = writer.length
    writer.text(`${index} 0 obj\n`)
  }

  beginObject(1)
  writer.text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  beginObject(2)
  writer.text('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  beginObject(3)
  writer.text(
    `<< /Type /Page /Parent 2 0 R /Resources ${pageResources} /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents 6 0 R >>\nendobj\n`
  )

  beginObject(4)
  writer.text('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  beginObject(5)
  writer.text('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n')

  beginObject(6)
  writer.text(`<< /Length ${contentBytes.length} >>\nstream\n`)
  writer.bytes(contentBytes)
  writer.text('\nendstream\nendobj\n')

  if (logoLayout) {
    beginObject(7)
    writer.text(
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`
    )
    writer.bytes(logo.bytes)
    writer.text('\nendstream\nendobj\n')
  }

  const xrefStart = writer.length
  writer.text(`xref\n0 ${objectCount + 1}\n`)
  writer.text('0000000000 65535 f \n')
  for (let i = 1; i <= objectCount; i += 1) {
    writer.text(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  }
  writer.text(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)

  return new Blob([writer.toUint8Array()], { type: 'application/pdf' })
}

// Downloads the PDF via a throwaway object URL and anchor click, the same
// pattern CaseCredentialsHandoff.jsx uses for its plain-text export. Loads
// the logo first (best-effort - see loadLogoForPdf) so the download always
// carries Rectifia's mark when the fetch succeeds.
export async function downloadSimplePdf(lines, filename) {
  const logo = await loadLogoForPdf()
  const blob = buildSimplePdf(lines, logo)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
