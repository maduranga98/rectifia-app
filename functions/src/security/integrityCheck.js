const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { pickMetadata } = require('../intake/syncCaseMetadata')
const { recordControlRun } = require('./controlRunLog')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const CASE_METADATA_COLLECTION = 'caseMetadata'
const MESSAGES_SUBCOLLECTION = 'messages'
const PULSE_RESPONSES_COLLECTION = 'pulseResponses'
const PULSE_INVITES_COLLECTION = 'pulseInvites'
const INTEGRITY_FINDINGS_COLLECTION = 'integrityFindings'
const INTEGRITY_CURSORS_COLLECTION = 'integrityCheckCursors'
const EVIDENCE_PREFIX = 'case-evidence'
const CONTROL_NAME = 'integrityCheck'

// A rotating window, not the whole platform, per run - see the cursor
// documents in INTEGRITY_CURSORS_COLLECTION. A weekly control that tries to
// re-check every case and every response every week either times out or
// costs more than the thing it protects; a cursor that advances every run and
// wraps around gives full coverage over a period of weeks instead, which is
// the same trade every other bounded sweep in this codebase makes (see
// MAX_CASES_PER_RUN in functions/src/retention/applyRetention.js).
const CASE_BATCH_SIZE = 300
const PULSE_RESPONSE_BATCH_SIZE = 300

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : value ?? null
}

async function writeFinding(firestore, finding) {
  await firestore.collection(INTEGRITY_FINDINGS_COLLECTION).add({
    ...finding,
    detectedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

async function getCursor(firestore, checkId) {
  const snap = await firestore.collection(INTEGRITY_CURSORS_COLLECTION).doc(checkId).get()
  return snap.exists ? snap.data().lastId ?? null : null
}

async function setCursor(firestore, checkId, lastId) {
  await firestore.collection(INTEGRITY_CURSORS_COLLECTION).doc(checkId).set({
    lastId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Compares the mirror's ACTUAL contents against what pickMetadata says it
// SHOULD contain, field by field, normalising Timestamps to millis so two
// equal instants compare equal regardless of object identity. Returns the
// list of field names that differ - empty means no drift.
function diffMetadata(expected, actual) {
  const drifted = []
  for (const key of Object.keys(expected)) {
    const expectedValue = expected[key]
    const actualValue = actual ? actual[key] : undefined
    const normalizedExpected =
      expectedValue && typeof expectedValue.toMillis === 'function' ? toMillis(expectedValue) : expectedValue
    const normalizedActual =
      actualValue && typeof actualValue.toMillis === 'function' ? toMillis(actualValue) : actualValue
    if (JSON.stringify(normalizedExpected ?? null) !== JSON.stringify(normalizedActual ?? null)) {
      drifted.push(key)
    }
  }
  return drifted
}

// One case's worth of the two Storage/Firestore checks and the caseMetadata
// drift check, all sharing the same case read.
async function checkCase(firestore, bucket, caseId) {
  const [caseSnap, metaSnap, messagesSnap, [evidenceFiles]] = await Promise.all([
    firestore.collection(CASES_COLLECTION).doc(caseId).get(),
    firestore.collection(CASE_METADATA_COLLECTION).doc(caseId).get(),
    firestore.collection(CASES_COLLECTION).doc(caseId).collection(MESSAGES_SUBCOLLECTION).get(),
    bucket.getFiles({ prefix: `${EVIDENCE_PREFIX}/${caseId}/` }),
  ])

  const findings = []

  // Case <-> caseMetadata mirror drift.
  if (caseSnap.exists && !metaSnap.exists) {
    findings.push({ type: 'case_metadata_missing', caseId, companyId: caseSnap.data().companyId ?? null })
  } else if (!caseSnap.exists && metaSnap.exists) {
    findings.push({ type: 'case_metadata_orphaned', caseId, companyId: metaSnap.data().companyId ?? null })
  } else if (caseSnap.exists && metaSnap.exists) {
    const expected = pickMetadata(caseSnap.data())
    const drifted = diffMetadata(expected, metaSnap.data())
    if (drifted.length > 0) {
      findings.push({
        type: 'case_metadata_drift',
        caseId,
        companyId: caseSnap.data().companyId ?? null,
        detail: `fields: ${drifted.join(', ')}`,
      })
    }
  }

  // Storage <-> Firestore evidence pointers, only meaningful if the case
  // still exists (a deleted case's evidence is verified empty by
  // applyRetention.js's hardDeleteCaseContent at delete time, not re-checked
  // here every week).
  if (caseSnap.exists) {
    const referencedFileNames = new Set()
    messagesSnap.docs.forEach((doc) => {
      const attachments = doc.data().attachments
      if (Array.isArray(attachments)) {
        attachments.forEach((a) => {
          if (a?.fileName) referencedFileNames.add(a.fileName)
        })
      }
    })

    const storedFileNames = new Set(evidenceFiles.map((f) => f.name.split('/').pop()))

    for (const fileName of storedFileNames) {
      if (!referencedFileNames.has(fileName)) {
        findings.push({
          type: 'orphaned_storage_object',
          caseId,
          companyId: caseSnap.data().companyId ?? null,
          detail: `case-evidence/${caseId}/${fileName}`,
        })
      }
    }
    for (const fileName of referencedFileNames) {
      if (!storedFileNames.has(fileName)) {
        findings.push({
          type: 'missing_storage_object',
          caseId,
          companyId: caseSnap.data().companyId ?? null,
          detail: `case-evidence/${caseId}/${fileName}`,
        })
      }
    }
  }

  return findings
}

// Checks 1, 2 and 4: walks a rotating page of cases (by document id, oldest-
// cursor-first, wrapping to the start once a page comes back short), and for
// each one runs the Storage<->Firestore evidence check in both directions
// plus the caseMetadata mirror drift check.
async function runCaseChecks(firestore) {
  const bucket = admin.storage().bucket()
  const cursor = await getCursor(firestore, 'cases')

  let query = firestore.collection(CASE_METADATA_COLLECTION).orderBy(admin.firestore.FieldPath.documentId())
  if (cursor) query = query.startAfter(cursor)
  let snapshot = await query.limit(CASE_BATCH_SIZE).get()

  // Wrap around: a short page means we reached the end of the collection, so
  // start the NEXT run from the beginning rather than stalling forever past
  // the last document id.
  let wrapped = false
  if (snapshot.size < CASE_BATCH_SIZE) {
    wrapped = true
  }

  let findingsCount = 0
  let casesChecked = 0

  for (const doc of snapshot.docs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const findings = await checkCase(firestore, bucket, doc.id)
      for (const finding of findings) {
        // eslint-disable-next-line no-await-in-loop
        await writeFinding(firestore, finding)
        findingsCount += 1
      }
      casesChecked += 1
    } catch (err) {
      logger.error('integrityCheck: case check failed', { caseId: doc.id, error: err.message })
    }
  }

  const lastDoc = snapshot.docs[snapshot.docs.length - 1]
  await setCursor(firestore, 'cases', wrapped ? null : lastDoc?.id ?? null)

  return { casesChecked, findingsCount }
}

// Check 3: no pulseResponse lacks a spent invite. Only responses carrying an
// inviteId (see analyzePulseResponse.js, added alongside this control) are
// checkable - older responses predate the field and are skipped rather than
// false-flagged, the same "unverifiable, not wrong" treatment
// authAccountFound gets in accessReview.js.
async function runPulseInviteChecks(firestore) {
  const cursor = await getCursor(firestore, 'pulseResponses')
  let query = firestore.collection(PULSE_RESPONSES_COLLECTION).orderBy(admin.firestore.FieldPath.documentId())
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query.limit(PULSE_RESPONSE_BATCH_SIZE).get()

  let checked = 0
  let findingsCount = 0

  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (!data.inviteId) continue
    checked += 1
    try {
      // eslint-disable-next-line no-await-in-loop
      const inviteSnap = await firestore.collection(PULSE_INVITES_COLLECTION).doc(data.inviteId).get()
      if (!inviteSnap.exists) {
        // eslint-disable-next-line no-await-in-loop
        await writeFinding(firestore, {
          type: 'pulse_response_missing_invite',
          companyId: data.companyId ?? null,
          detail: `pulseResponse ${doc.id} references invite ${data.inviteId}, which no longer exists`,
        })
        findingsCount += 1
      } else if (inviteSnap.data().status !== 'used') {
        // eslint-disable-next-line no-await-in-loop
        await writeFinding(firestore, {
          type: 'pulse_response_invite_not_used',
          companyId: data.companyId ?? null,
          detail: `pulseResponse ${doc.id}'s invite ${data.inviteId} has status "${inviteSnap.data().status}"`,
        })
        findingsCount += 1
      }
    } catch (err) {
      logger.error('integrityCheck: pulse invite join failed', { responseId: doc.id, error: err.message })
    }
  }

  const lastDoc = snapshot.docs[snapshot.docs.length - 1]
  await setCursor(firestore, 'pulseResponses', snapshot.size < PULSE_RESPONSE_BATCH_SIZE ? null : lastDoc?.id ?? null)

  return { responsesChecked: checked, findingsCount }
}

// Runs weekly. Writes a securityControlRuns row every time, including a week
// with zero drift found - "the sweep ran and found nothing" is the evidence,
// not an absence of rows in integrityFindings.
exports.integrityCheck = onSchedule('every monday 04:00', async () => {
  const firestore = admin.firestore()

  let caseResult = { casesChecked: 0, findingsCount: 0 }
  let pulseResult = { responsesChecked: 0, findingsCount: 0 }
  let failures = 0

  try {
    caseResult = await runCaseChecks(firestore)
  } catch (err) {
    failures += 1
    logger.error('integrityCheck: case checks failed', { error: err.message })
  }

  try {
    pulseResult = await runPulseInviteChecks(firestore)
  } catch (err) {
    failures += 1
    logger.error('integrityCheck: pulse invite checks failed', { error: err.message })
  }

  await recordControlRun(firestore, {
    control: CONTROL_NAME,
    outcome: failures === 0 ? 'ok' : 'partial_failure',
    summary: {
      casesChecked: caseResult.casesChecked,
      pulseResponsesChecked: pulseResult.responsesChecked,
      findingsCount: caseResult.findingsCount + pulseResult.findingsCount,
      failures,
    },
  })
})

exports.INTEGRITY_FINDINGS_COLLECTION = INTEGRITY_FINDINGS_COLLECTION
