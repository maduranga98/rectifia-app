const { onObjectFinalized } = require('firebase-functions/v2/storage')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { POLICY_PREFIX, EXTENSION_KINDS } = require('./policyStorage')

if (!admin.apps.length) {
  admin.initializeApp()
}

const POLICIES_COLLECTION = 'companyPolicies'
const CHUNKS_SUBCOLLECTION = 'chunks'

// Target chunk sizing, in characters. Big enough that a clause keeps its
// context, small enough that retrievePolicyContext.js can fit several from
// several categories inside its ~6000-character cap. Overlap is by paragraph
// (see chunkParagraphs) rather than a fixed character window, so a chunk never
// splits mid-sentence and a clause that straddles a boundary still appears
// whole in one of the two chunks.
const CHUNK_MIN_CHARS = 800
const CHUNK_MAX_CHARS = 1200

// ---------------------------------------------------------------------------
// Text extraction. One extractor per allowed kind; the kind comes from the
// stored extension, which policyStorage.js guarantees is present and canonical.
// pdf-parse and mammoth are required lazily so a TXT/MD ingest never pays to
// load a PDF or DOCX parser it will not use.
// ---------------------------------------------------------------------------
async function extractText(kind, buffer) {
  if (kind === 'pdf') {
    const pdfParse = require('pdf-parse')
    const parsed = await pdfParse(buffer)
    return parsed.text ?? ''
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth')
    const { value } = await mammoth.extractRawText({ buffer })
    return value ?? ''
  }
  // text/plain and markdown are read as-is.
  return buffer.toString('utf8')
}

function kindFromFileName(fileName) {
  const match = String(fileName).toLowerCase().match(/(\.[a-z0-9]+)$/)
  const extension = match ? match[1] : ''
  return EXTENSION_KINDS.get(extension) ?? 'text'
}

// ---------------------------------------------------------------------------
// Heading detection. A heading is what gives a chunk its provenance ("Code of
// Conduct > Reporting > Timeframes"), which is what the investigation view and
// the report cite. Three shapes are recognised, in priority order:
//   * Markdown ATX headings (`## Reporting`), carrying an explicit level.
//   * Numbered clause headings (`3.` / `3.1 Reporting`), levelled by depth.
//   * Short, title-like lines with no terminal punctuation, treated as level 1.
// Anything else is body text. A document with none of these chunks flat, with
// an empty heading path - the graceful-degradation path, same output as a plain
// text dump would give.
// ---------------------------------------------------------------------------
function detectHeading(line) {
  const trimmed = line.trim()
  if (!trimmed) return null

  const atx = trimmed.match(/^(#{1,6})\s+(.*\S)\s*#*$/)
  if (atx) {
    return { level: atx[1].length, text: atx[2].trim() }
  }

  const numbered = trimmed.match(/^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/)
  if (numbered && numbered[2].length <= 120) {
    const depth = numbered[1].split('.').length
    return { level: depth, text: `${numbered[1]} ${numbered[2].trim()}` }
  }

  // A short line with no sentence-ending punctuation, in a document that is
  // otherwise paragraphs - the common "ALL CAPS SECTION" or "Grievance
  // Procedure" heading. Kept conservative (<= 80 chars, few words, no trailing
  // period) so a genuine short sentence is not mistaken for a heading.
  if (
    trimmed.length <= 80 &&
    !/[.!?:;,]$/.test(trimmed) &&
    trimmed.split(/\s+/).length <= 10 &&
    /[A-Za-z]/.test(trimmed) &&
    (trimmed === trimmed.toUpperCase() || /^[A-Z0-9]/.test(trimmed))
  ) {
    return { level: 1, text: trimmed }
  }

  return null
}

// Maintains the heading stack so each section carries its full path from the
// top. A new heading at level L replaces everything at level >= L.
function pushHeading(stack, heading) {
  const next = stack.filter((entry) => entry.level < heading.level)
  next.push(heading)
  return next
}

// Splits raw text into { headingPath, paragraphs } sections. Lines are grouped
// under the most recent heading path; blank lines separate paragraphs.
function splitIntoSections(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const sections = []
  let stack = []
  let current = { headingPath: [], paragraphs: [], buffer: [] }

  const flushParagraph = () => {
    const joined = current.buffer.join(' ').replace(/\s+/g, ' ').trim()
    if (joined) current.paragraphs.push(joined)
    current.buffer = []
  }
  const flushSection = () => {
    flushParagraph()
    if (current.paragraphs.length > 0) {
      sections.push({ headingPath: current.headingPath, paragraphs: current.paragraphs })
    }
  }

  for (const line of lines) {
    const heading = detectHeading(line)
    if (heading) {
      flushSection()
      stack = pushHeading(stack, heading)
      current = { headingPath: stack.map((h) => h.text), paragraphs: [], buffer: [] }
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    current.buffer.push(line.trim())
  }
  flushSection()

  return sections
}

// Groups a section's paragraphs into ~800-1200 char chunks with a one-paragraph
// overlap, so context that spans a boundary is not lost. A single paragraph
// longer than the max becomes its own chunk rather than being split mid-text.
function chunkParagraphs(paragraphs) {
  const chunks = []
  let current = []
  let length = 0

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]
    current.push(paragraph)
    length += paragraph.length + 1

    if (length >= CHUNK_MIN_CHARS) {
      chunks.push(current.join('\n\n'))
      // One-paragraph overlap into the next chunk.
      const overlap = current[current.length - 1]
      current = [overlap]
      length = overlap.length + 1
    }

    if (length > CHUNK_MAX_CHARS && current.length === 1) {
      // A lone oversized paragraph: emit it and start clean, no overlap of a
      // chunk that is already too big.
      chunks.push(current.join('\n\n'))
      current = []
      length = 0
    }
  }

  // The trailing remainder. If it is only the carried-over overlap paragraph
  // and that paragraph already closed the previous chunk, drop it.
  const remainder = current.join('\n\n').trim()
  if (remainder && !(chunks.length > 0 && chunks[chunks.length - 1].endsWith(remainder))) {
    chunks.push(remainder)
  }

  return chunks
}

// Turns extracted text into ordered chunk records. Each carries its heading
// path and a stable order index; categories and summary are added later by
// tagPolicyChunks.js.
function buildChunks(text) {
  const sections = splitIntoSections(text)
  const records = []
  let order = 0
  for (const section of sections) {
    for (const chunkText of chunkParagraphs(section.paragraphs)) {
      const trimmed = chunkText.trim()
      if (!trimmed) continue
      records.push({ order, headingPath: section.headingPath, text: trimmed })
      order += 1
    }
  }
  return records
}

// Extracts, chunks, and writes chunks for one newly finalized policy object.
// Scoped to the company-policies/ prefix by an early return - v2 Storage
// triggers fire for the whole bucket, so the prefix check is the scope. On
// success the parent doc goes 'active'; on any failure it goes 'failed' with a
// message. A document is never left stuck in 'processing'.
exports.ingestPolicyDocument = onObjectFinalized(async (event) => {
  const object = event.data
  const name = object?.name ?? ''
  if (!name.startsWith(`${POLICY_PREFIX}/`)) return

  // company-policies/{companyId}/{policyId}/{fileName}
  const parts = name.split('/')
  if (parts.length < 4) {
    logger.warn('ingestPolicyDocument: unexpected object path', { name })
    return
  }
  const policyId = parts[2]
  const fileName = parts.slice(3).join('/')

  const firestore = admin.firestore()
  const policyRef = firestore.collection(POLICIES_COLLECTION).doc(policyId)
  const policySnapshot = await policyRef.get()
  if (!policySnapshot.exists) {
    logger.warn('ingestPolicyDocument: no policy document for object', { policyId, name })
    return
  }

  const policy = policySnapshot.data()
  // Only ingest the object this document actually points at - guards against a
  // stray write under the prefix and against re-processing an old version's
  // bytes.
  if (policy.storagePath && policy.storagePath !== name) {
    logger.warn('ingestPolicyDocument: object does not match policy storagePath', {
      policyId,
      name,
      storagePath: policy.storagePath,
    })
    return
  }

  // Idempotency guard: Cloud Storage finalize events are delivered at-least-
  // once, so a redelivery of an event already handled by this function is
  // normal, expected behaviour, not an edge case. status only ever moves to
  // 'active' or 'failed', and only ever from this function, so either value
  // means ingestion already concluded for this policyId - any further
  // delivery is a no-op by construction. A new policy version always gets a
  // new policyId (see "Immutable-forward versioning" below), so there is no
  // legitimate reason for a second delivery to re-ingest here.
  if (policy.status === 'active' || policy.status === 'failed') {
    logger.info('ingestPolicyDocument: skipping duplicate event delivery', {
      policyId,
      name,
      status: policy.status,
    })
    return
  }

  try {
    const bucket = admin.storage().bucket(object.bucket)
    const [buffer] = await bucket.file(name).download()

    const kind = kindFromFileName(fileName)
    const text = await extractText(kind, buffer)

    const chunks = buildChunks(text)
    if (chunks.length === 0) {
      throw new Error('No readable text could be extracted from the document')
    }

    // Write chunks in batches, then flip the parent to active. The chunk
    // onCreate trigger (tagPolicyChunks.js) fires per chunk to tag categories.
    let batch = firestore.batch()
    let opsInBatch = 0
    for (const chunk of chunks) {
      const chunkRef = policyRef.collection(CHUNKS_SUBCOLLECTION).doc()
      batch.set(chunkRef, {
        order: chunk.order,
        headingPath: chunk.headingPath,
        text: chunk.text,
        categories: [],
        summary: '',
      })
      opsInBatch += 1
      if (opsInBatch >= 400) {
        await batch.commit()
        batch = firestore.batch()
        opsInBatch = 0
      }
    }
    if (opsInBatch > 0) await batch.commit()

    await policyRef.update({
      status: 'active',
      chunkCount: chunks.length,
      errorMessage: null,
      ingestedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    // Immutable-forward versioning: now that this version is live, archive any
    // earlier active version of the same title. Earlier versions and their
    // chunks are retained so a closed case's report still resolves the exact
    // clauses that were in effect when it was created.
    if (policy.title && typeof policy.version === 'number') {
      const priorSnapshot = await firestore
        .collection(POLICIES_COLLECTION)
        .where('companyId', '==', policy.companyId)
        .where('title', '==', policy.title)
        .where('status', '==', 'active')
        .get()
      const archiveBatch = firestore.batch()
      let toArchive = 0
      priorSnapshot.forEach((doc) => {
        if (doc.id === policyId) return
        if (Number(doc.data().version) < policy.version) {
          archiveBatch.update(doc.ref, { status: 'archived', archivedAt: admin.firestore.FieldValue.serverTimestamp() })
          toArchive += 1
        }
      })
      if (toArchive > 0) await archiveBatch.commit()
    }
  } catch (err) {
    logger.error('ingestPolicyDocument: ingestion failed', { policyId, name, error: err.message })
    await policyRef.update({
      status: 'failed',
      errorMessage: err.message?.slice(0, 500) ?? 'Ingestion failed',
    })
  }
})

exports.buildChunks = buildChunks
