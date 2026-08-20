// WHY THIS MATTERS: askInThread is the handler-initiated counterpart to
// aiFollowUp.js's reactive follow-up - it drafts a question but never writes
// to the thread itself, and it must only be reachable by the Case Handler
// actually assigned to the case (the same gate every other case-content
// action uses). This suite pins that authorization, the "intent required"
// input validation, and that the draft is returned as plain text rather than
// posted anywhere.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import Anthropic from '@anthropic-ai/sdk'
import { askInThread } from '../askInThread.js'

const CASE_ID = 'RC-2026-0003'
const COMPANY_ID = 'company-1'
const HANDLER_UID = 'handler-1'
const OTHER_UID = 'handler-2'

function seedCase(firestore, overrides = {}) {
  firestore.seed('cases', CASE_ID, {
    companyId: COMPANY_ID,
    category: 'harassment',
    assignedHandlerId: HANDLER_UID,
    responses: [{ questionId: 'q1', type: 'text', value: 'It happened on a Tuesday.' }],
    ...overrides,
  })
}

function seedHandlerStaff(firestore, uid = HANDLER_UID) {
  firestore.seed(`companies/${COMPANY_ID}/staff`, uid, { role: 'caseHandler' })
}

function claudeSuccessHandler() {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ question: 'Could you share the exact date?' }) }],
  }
}

describe('askInThread', () => {
  beforeEach(() => {
    admin.__reset()
    Anthropic.__reset()
    Anthropic.__setHandler(claudeSuccessHandler)
  })

  it('drafts a question for the assigned handler and never writes to the thread', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedHandlerStaff(firestore)

    const result = await askInThread({
      auth: { uid: HANDLER_UID },
      data: { caseId: CASE_ID, intent: 'ask about the exact date of the incident' },
    })

    expect(result.question).toBe('Could you share the exact date?')
    const messages = await firestore.collection('cases').doc(CASE_ID).collection('messages').get()
    expect(messages.docs).toHaveLength(0)
  })

  it('rejects a handler who is not assigned to the case', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedHandlerStaff(firestore, OTHER_UID)

    await expect(
      askInThread({
        auth: { uid: OTHER_UID },
        data: { caseId: CASE_ID, intent: 'ask about the exact date' },
      })
    ).rejects.toThrow()
  })

  it('rejects an unauthenticated call', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)

    await expect(
      askInThread({ data: { caseId: CASE_ID, intent: 'ask about the exact date' } })
    ).rejects.toThrow()
  })

  it('rejects a call with no intent', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedHandlerStaff(firestore)

    await expect(
      askInThread({ auth: { uid: HANDLER_UID }, data: { caseId: CASE_ID, intent: '   ' } })
    ).rejects.toThrow()
  })

  it('sends the intent and category to Claude without an output_config.effort field', async () => {
    const firestore = admin.firestore()
    seedCase(firestore)
    seedHandlerStaff(firestore)

    await askInThread({
      auth: { uid: HANDLER_UID },
      data: { caseId: CASE_ID, intent: 'ask about the exact date of the incident' },
    })

    const [call] = Anthropic.__calls()
    expect(call.model).toBe('claude-haiku-4-5-20251001')
    expect(call.output_config).not.toHaveProperty('effort')
    expect(call.messages[0].content).toContain('ask about the exact date of the incident')
  })
})
