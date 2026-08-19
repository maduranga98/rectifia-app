// WHY THIS MATTERS: translateMessage is now reachable from both sides of the
// case thread - a Case Handler via Firebase Auth, and (as of this change) a
// reporter via Case ID + passcode, the same credential every other
// reporter-facing callable in this module uses. This suite pins that both
// paths genuinely authorize (and that neither one - nor an unauthenticated
// caller - can slip through), and that the Haiku request this callable sends
// never regresses into passing output_config.effort, which is invalid on
// Haiku and made every call to this endpoint 400 during the outage
// documented in functions/src/policy/backfillPolicyTags.js.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import { translateMessage } from '../translateMessage.js'

const CASE_ID = 'RC-2026-0002'
const PASSCODE = 'ABCDEFGHJKLM'
const COMPANY_ID = 'company-1'
const HANDLER_UID = 'handler-1'

function hashPasscode(passcode, salt) {
  return crypto.scryptSync(passcode, salt, 64).toString('hex')
}

function seedCase(firestore) {
  const salt = 'fixed-salt'
  firestore.seed('cases', CASE_ID, {
    companyId: COMPANY_ID,
    passcodeHash: hashPasscode(PASSCODE, salt),
    passcodeSalt: salt,
    assignedHandlerId: HANDLER_UID,
  })
}

function seedHandlerStaff(firestore) {
  firestore.seed(`companies/${COMPANY_ID}/staff`, HANDLER_UID, { role: 'caseHandler' })
}

function seedMessage(firestore, id, overrides = {}) {
  firestore
    .collection('cases')
    .doc(CASE_ID)
    .collection('messages')
    .doc(id)
    .set({
      sender: 'investigator',
      type: 'message',
      text: 'Please share the date of the January incident.',
      ...overrides,
    })
}

function claudeSuccessHandler() {
  return {
    stop_reason: 'end_turn',
    content: [
      {
        type: 'text',
        text: JSON.stringify({ translatedText: 'කරුණාකර...', sourceLanguageGuess: 'English' }),
      },
    ],
  }
}

describe('translateMessage', () => {
  beforeEach(() => {
    admin.__reset()
    Anthropic.__reset()
    Anthropic.__setHandler(claudeSuccessHandler)
  })

  it('an investigator-authenticated translate call succeeds', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedHandlerStaff(firestore)
    seedMessage(firestore, 'msg-1')

    const result = await translateMessage({
      auth: { uid: HANDLER_UID },
      data: { caseId: CASE_ID, messageId: 'msg-1', targetLang: 'si' },
    })

    expect(result.translation.text).toBe('කරුණාකර...')
  })

  it('a reporter-authenticated (valid Case ID + passcode) translate call also succeeds', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedMessage(firestore, 'msg-2')

    const result = await translateMessage({
      data: { caseId: CASE_ID, messageId: 'msg-2', targetLang: 'si', passcode: PASSCODE },
    })

    expect(result.translation.text).toBe('කරුණාකර...')
  })

  it('an unauthenticated call with no passcode is rejected', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedMessage(firestore, 'msg-3')

    await expect(
      translateMessage({ data: { caseId: CASE_ID, messageId: 'msg-3', targetLang: 'si' } })
    ).rejects.toThrow()
  })

  it('a call with an invalid passcode is rejected', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedMessage(firestore, 'msg-4')

    await expect(
      translateMessage({
        data: { caseId: CASE_ID, messageId: 'msg-4', targetLang: 'si', passcode: 'WRONGPASSCODE' },
      })
    ).rejects.toThrow()
  })

  it('a reporter cannot translate a manual_log entry', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedMessage(firestore, 'msg-log', { type: 'manual_log', sender: 'investigator' })

    await expect(
      translateMessage({
        data: { caseId: CASE_ID, messageId: 'msg-log', targetLang: 'si', passcode: PASSCODE },
      })
    ).rejects.toThrow()
  })

  it('a reporter cannot translate their own message', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedMessage(firestore, 'msg-own', { sender: 'reporter', type: 'message' })

    await expect(
      translateMessage({
        data: { caseId: CASE_ID, messageId: 'msg-own', targetLang: 'si', passcode: PASSCODE },
      })
    ).rejects.toThrow()
  })

  it('sends the Haiku request without an output_config.effort field (the field that 400s on Haiku)', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedHandlerStaff(firestore)
    seedMessage(firestore, 'msg-5')

    await translateMessage({
      auth: { uid: HANDLER_UID },
      data: { caseId: CASE_ID, messageId: 'msg-5', targetLang: 'si' },
    })

    const [call] = Anthropic.__calls()
    expect(call.model).toBe('claude-haiku-4-5-20251001')
    expect(call.output_config).not.toHaveProperty('effort')
  })
})
