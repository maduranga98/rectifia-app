// WHY THIS MATTERS: manual_log entries are internal Case Handler notes -
// getCaseThread is the reporter-facing callable, reachable with nothing but a
// Case ID and passcode. Before this suite, nothing pinned that a manual_log
// message never reaches serializeMessage on that path, so a filter added
// upstream (or reverted later) could silently start leaking Case Handler
// notes back to the person they're about.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import crypto from 'crypto'
import { getCaseThread, getCaseThreadForHandler } from '../caseThread.js'

const CASE_ID = 'RC-2026-0001'
const PASSCODE = 'ABCDEFGHJKLM'
const COMPANY_ID = 'company-1'
const HANDLER_UID = 'handler-1'

function hashPasscode(passcode, salt) {
  return crypto.scryptSync(passcode, salt, 64).toString('hex')
}

function seedCase(firestore, overrides = {}) {
  const salt = 'fixed-salt'
  firestore.seed('cases', CASE_ID, {
    companyId: COMPANY_ID,
    passcodeHash: hashPasscode(PASSCODE, salt),
    passcodeSalt: salt,
    assignedHandlerId: HANDLER_UID,
    crisisFlag: false,
    ...overrides,
  })
}

function seedHandlerStaff(firestore) {
  firestore.seed(`companies/${COMPANY_ID}/staff`, HANDLER_UID, { role: 'caseHandler' })
}

function seedMessages(firestore) {
  const caseRef = firestore.collection('cases').doc(CASE_ID)
  caseRef.collection('messages').doc('msg-log').set({
    sender: 'investigator',
    type: 'manual_log',
    text: 'Internal note: called witness, did not corroborate.',
    attachments: [],
    timestamp: { toMillis: () => 1000 },
  })
  caseRef.collection('messages').doc('msg-ordinary').set({
    sender: 'investigator',
    type: 'message',
    text: 'Thanks for the update, we will follow up shortly.',
    attachments: [],
    timestamp: { toMillis: () => 2000 },
  })
}

describe('caseThread manual_log filtering', () => {
  beforeEach(() => {
    admin.__reset()
  })

  it('getCaseThread (reporter-facing) excludes manual_log entries but keeps ordinary ones', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedMessages(firestore)

    const result = await getCaseThread({ data: { caseId: CASE_ID, passcode: PASSCODE } })

    const types = result.messages.map((m) => m.type)
    expect(types).not.toContain('manual_log')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].id).toBe('msg-ordinary')
    expect(result.messages[0].text).toBe('Thanks for the update, we will follow up shortly.')
  })

  it('getCaseThreadForHandler (staff-facing) still returns both the manual_log and the ordinary message', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedHandlerStaff(firestore)
    seedMessages(firestore)

    const result = await getCaseThreadForHandler({
      auth: { uid: HANDLER_UID },
      data: { caseId: CASE_ID },
    })

    const ids = result.messages.map((m) => m.id).sort()
    expect(ids).toEqual(['msg-log', 'msg-ordinary'])
    const logEntry = result.messages.find((m) => m.id === 'msg-log')
    expect(logEntry.type).toBe('manual_log')
  })
})
