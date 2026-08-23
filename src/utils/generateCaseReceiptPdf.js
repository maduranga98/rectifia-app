// Client-side branded PDF receipt for a case's tracking details. Built with
// jsPDF and the `qrcode` package - both pure in-browser renderers, so this
// module never makes a network call and never sends caseId/passcode/
// trackingUrl anywhere but into the PDF bytes it hands back as a download.
//
// Deliberately takes the three values as plain arguments rather than
// fetching or re-deriving them: they only ever exist in memory for the
// short window between submitCase's response and this function returning,
// and letting `passcode` fall out of scope once the PDF blob exists is the
// point - see CaseCredentialsHandoff.jsx / Submit.jsx for why nothing here
// is ever persisted (no Firestore write, no logging, no localStorage).
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import logoUrl from '../assets/brand/rectifia-logo.png'

const NAVY = '#0B2C49'
const AMBER = '#DB9B3A'
const CHARCOAL = '#1E2A38'
const GRAY = '#8A93A0'
const BORDER = '#E4E7EC'
const AMBER_TINT = '#FBF1E1'
const PAGE_BG = '#F7F6F3'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const CARD_WIDTH = 400
const CARD_HEIGHT = 580
const CARD_RADIUS = 16
const CARD_X = (PAGE_WIDTH - CARD_WIDTH) / 2
const CARD_Y = (PAGE_HEIGHT - CARD_HEIGHT) / 2

const HEADER_HEIGHT = 150
const ACCENT_HEIGHT = 3

// Loads the bundled logo asset (Vite resolves the import to a same-origin
// URL) and hands back a PNG data URL jsPDF's addImage can embed directly -
// no fetch to anything outside the app's own build output.
async function loadLogoDataUrl() {
  const response = await fetch(logoUrl)
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

function setFillColorHex(doc, hex) {
  doc.setFillColor(...hexToRgb(hex))
}

function setTextColorHex(doc, hex) {
  doc.setTextColor(...hexToRgb(hex))
}

function setDrawColorHex(doc, hex) {
  doc.setDrawColor(...hexToRgb(hex))
}

// A small filled triangle with an exclamation mark cut from it, drawn as
// vector paths rather than the Unicode ⚠ glyph - many PDF viewers fall back
// to Helvetica for text and render that codepoint as a missing-glyph box.
function drawWarningGlyph(doc, cx, cy, size) {
  const half = size / 2
  setFillColorHex(doc, AMBER)
  doc.triangle(
    cx,
    cy - half,
    cx - half,
    cy + half,
    cx + half,
    cy + half,
    'F'
  )
  setFillColorHex(doc, '#FFFFFF')
  doc.rect(cx - size * 0.06, cy - half * 0.35, size * 0.12, size * 0.4, 'F')
  doc.circle(cx, cy + half * 0.55, size * 0.07, 'F')
}

function drawCredentialBox(doc, x, y, width, label, value) {
  setTextColorHex(doc, GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(label.toUpperCase(), x, y)

  const boxY = y + 8
  const boxHeight = 32
  setFillColorHex(doc, '#F7F8FA')
  setDrawColorHex(doc, BORDER)
  doc.setLineWidth(1)
  doc.roundedRect(x, boxY, width, boxHeight, 6, 6, 'FD')

  setTextColorHex(doc, CHARCOAL)
  doc.setFont('courier', 'bold')
  doc.setFontSize(15)
  doc.text(value, x + 14, boxY + boxHeight / 2 + 5, { charSpace: 1.2 })

  return boxY + boxHeight
}

// Builds the receipt PDF and triggers a browser download named
// `rectifia-case-${caseId}.pdf`. Never opens a new tab and never uploads
// the file anywhere - `doc.save()` is a pure client-side blob download.
export async function generateCaseReceiptPdf({ caseId, passcode, trackingUrl }) {
  const [logoDataUrl, qrDataUrl] = await Promise.all([
    loadLogoDataUrl(),
    QRCode.toDataURL(trackingUrl, {
      margin: 0,
      width: 256,
      color: { dark: NAVY, light: '#FFFFFF' },
    }),
  ])

  const doc = new jsPDF({ unit: 'pt', format: [PAGE_WIDTH, PAGE_HEIGHT] })

  setFillColorHex(doc, PAGE_BG)
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F')

  // Card background, then the navy header clipped to the card's rounded
  // top corners so the band never overhangs the card's silhouette.
  setFillColorHex(doc, '#FFFFFF')
  setDrawColorHex(doc, BORDER)
  doc.setLineWidth(1)
  doc.roundedRect(CARD_X, CARD_Y, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS, CARD_RADIUS, 'FD')

  doc.saveGraphicsState()
  doc.roundedRect(CARD_X, CARD_Y, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS, CARD_RADIUS, null)
  doc.clip()
  doc.discardPath()

  setFillColorHex(doc, NAVY)
  doc.rect(CARD_X, CARD_Y, CARD_WIDTH, HEADER_HEIGHT, 'F')

  const logoSize = 34
  const logoX = CARD_X + 28
  const logoY = CARD_Y + 24
  doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoSize, logoSize)

  setTextColorHex(doc, '#FFFFFF')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text('RECTIFIA', logoX + logoSize + 12, logoY + 15, { charSpace: 1 })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  setTextColorHex(doc, '#C9D6E3')
  doc.text('Fair cases. Consistent outcomes.', logoX + logoSize + 12, logoY + 29)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  setTextColorHex(doc, '#FFFFFF')
  doc.text('Case Tracking Details', CARD_X + 28, CARD_Y + 100)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  setTextColorHex(doc, '#C9D6E3')
  doc.text('Keep this confidential — it is your only way back in', CARD_X + 28, CARD_Y + 118)

  doc.restoreGraphicsState()

  // 3px amber accent rule directly under the header band.
  setFillColorHex(doc, AMBER)
  doc.rect(CARD_X, CARD_Y + HEADER_HEIGHT, CARD_WIDTH, ACCENT_HEIGHT, 'F')

  let y = CARD_Y + HEADER_HEIGHT + ACCENT_HEIGHT + 30
  const contentX = CARD_X + 28
  const contentWidth = CARD_WIDTH - 56

  y = drawCredentialBox(doc, contentX, y, contentWidth, 'Case ID', caseId) + 26
  y = drawCredentialBox(doc, contentX, y, contentWidth, 'Passcode', passcode) + 20

  setDrawColorHex(doc, BORDER)
  doc.setLineWidth(1)
  doc.line(contentX, y, contentX + contentWidth, y)
  y += 24

  const qrSize = 90
  doc.addImage(qrDataUrl, 'PNG', contentX, y, qrSize, qrSize)

  const textX = contentX + qrSize + 16
  const textWidth = contentWidth - qrSize - 16
  setTextColorHex(doc, GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('SCAN OR VISIT', textX, y + 12)

  setTextColorHex(doc, NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  const urlLines = doc.splitTextToSize(trackingUrl, textWidth)
  doc.text(urlLines, textX, y + 28)

  setTextColorHex(doc, GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const noteY = y + 28 + urlLines.length * 12 + 8
  doc.text(doc.splitTextToSize('No login needed — Case ID + passcode only', textWidth), textX, noteY)

  y += qrSize + 30

  // Amber-tinted "keep this private" callout.
  const calloutHeight = 84
  setFillColorHex(doc, AMBER_TINT)
  setDrawColorHex(doc, AMBER)
  doc.setLineWidth(1)
  doc.roundedRect(contentX, y, contentWidth, calloutHeight, 8, 8, 'FD')

  drawWarningGlyph(doc, contentX + 24, y + 30, 18)

  setTextColorHex(doc, CHARCOAL)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('KEEP THIS PRIVATE', contentX + 46, y + 22)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const calloutBody = doc.splitTextToSize(
    'Store these details somewhere safe. They cannot be reissued — without them, there is no way back into this case.',
    contentWidth - 62
  )
  doc.text(calloutBody, contentX + 46, y + 36)

  // Footer.
  const footerY = CARD_Y + CARD_HEIGHT - 34
  setDrawColorHex(doc, BORDER)
  doc.setLineWidth(1)
  doc.line(contentX, footerY, contentX + contentWidth, footerY)

  setTextColorHex(doc, GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(
    'rectifia.com • Confidential reporting, built for trust',
    CARD_X + CARD_WIDTH / 2,
    footerY + 16,
    { align: 'center' }
  )

  doc.save(`rectifia-case-${caseId}.pdf`)
}

export default generateCaseReceiptPdf
