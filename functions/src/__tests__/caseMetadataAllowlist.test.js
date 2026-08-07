// WHY THIS MATTERS: caseMetadata/{caseId} is the one case-derived collection
// firestore.rules opens directly to the HR Coordinator role (see
// functions/src/intake/syncCaseMetadata.js's module comment) - anything
// mirrored into it is readable by a role that must never see what was
// reported or by whom, because that role also holds the reassignment power
// and is exactly the kind of insider a conflict-of-interest control exists
// for. pickMetadata() is an explicit allowlist, not an omit-list, precisely
// so a future field added to cases/{caseId} can't leak into this mirror by
// accident. If a questionnaire free-text answer, a message body, or an
// identity field ever ends up in this object, it has moved from a
// rules-gated vault into a collection an HR Coordinator can read at will.
import { describe, it, expect } from 'vitest'
import { pickMetadata } from '../intake/syncCaseMetadata.js'

// Everything a case document might legitimately carry that must NEVER be
// mirrored: the questionnaire's free-text answers, message content, and
// every identity-bearing field (encrypted or not).
const FORBIDDEN_KEYS = [
  'responses', // questionnaire free text
  'reporterIdentity', // the AES-GCM identity vault envelope
  'contactEmail', // the AES-GCM contact-channel envelope
  'contactEmailAddedAt',
  'enteredByUid', // who typed up a staff-filed case - audit material, not dashboard material
  'enteredByRole',
  'tierChangedAt', // timeline detail for the case report, not a dashboard column
  'tierChangedBy',
]

const SENSITIVE_FREE_TEXT = 'My manager screamed at me in the parking lot and threatened my job.'

function caseFixture(overrides = {}) {
  return {
    caseId: 'RC-2026-0001',
    companyId: 'company-1',
    category: 'harassment',
    severityScore: 72,
    evidenceScore: 40,
    status: 'open',
    routingReason: null,
    assignedHandlerId: 'handler-1',
    department: 'engineering',
    priority: 'high',
    acknowledgmentDueAt: 1700000000000,
    feedbackDueAt: 1700100000000,
    createdAt: 1699000000000,
    tier: 'confidential',
    source: 'reporter',
    intakeMethod: 'web',
    followUpStatus: 'pending',
    nextFollowUpAt: 1701000000000,
    closedAt: null,
    acknowledgmentSentAt: null,
    feedbackGivenAt: null,
    actionTaken: null,
    // The sensitive material the allowlist must exclude:
    responses: [
      { questionId: 'incident_description', value: SENSITIVE_FREE_TEXT },
      { questionId: 'subject_department', value: 'Operations' },
      { questionId: 'subject_role', value: 'Senior Manager' },
    ],
    reporterIdentity: {
      vault: { ciphertext: 'c2Vuc2l0aXZl', iv: 'aXY=', authTag: 'dGFn' },
      fieldsOnFile: ['name', 'email'],
      storedAt: 1699000000000,
      storedByUid: 'staff-uid-1',
    },
    contactEmail: { vault: { ciphertext: 'ZW1haWw=', iv: 'aXY=', authTag: 'dGFn' } },
    contactEmailAddedAt: 1699100000000,
    enteredByUid: 'staff-uid-1',
    enteredByRole: 'caseHandler',
    tierChangedAt: 1699200000000,
    tierChangedBy: 'reporter',
    ...overrides,
  }
}

describe('caseMetadataAllowlist', () => {
  it('the allowlist never includes a forbidden key, for any input shape', () => {
    const mirrored = pickMetadata(caseFixture())
    const mirroredKeys = Object.keys(mirrored)

    for (const forbidden of FORBIDDEN_KEYS) {
      expect(mirroredKeys).not.toContain(forbidden)
    }
  })

  it('a fixture case containing questionnaire free text mirrors none of that text', () => {
    const mirrored = pickMetadata(caseFixture())
    const serialized = JSON.stringify(mirrored)

    expect(serialized).not.toContain(SENSITIVE_FREE_TEXT)
    // Nor any substring of it, in case of partial copying.
    expect(serialized).not.toContain('screamed at me')
  })

  it('a fixture case containing identity ciphertext mirrors none of the vault envelopes', () => {
    const mirrored = pickMetadata(caseFixture())
    const serialized = JSON.stringify(mirrored)

    expect(serialized).not.toContain('c2Vuc2l0aXZl') // reporterIdentity ciphertext
    expect(serialized).not.toContain('ZW1haWw=') // contactEmail ciphertext
  })

  it('still mirrors the fields the HR Coordinator dashboard is allowed to read', () => {
    const mirrored = pickMetadata(caseFixture())

    expect(mirrored).toMatchObject({
      companyId: 'company-1',
      category: 'harassment',
      severityScore: 72,
      evidenceScore: 40,
      status: 'open',
      assignedHandlerId: 'handler-1',
      department: 'engineering',
      priority: 'high',
      tier: 'confidential',
      source: 'reporter',
      intakeMethod: 'web',
    })
  })

  it('a case document with no tier field at all mirrors as anonymous, never undefined', () => {
    const mirrored = pickMetadata(caseFixture({ tier: undefined }))
    expect(mirrored.tier).toBe('anonymous')
  })
})
