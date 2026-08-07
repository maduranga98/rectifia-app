// WHY THIS MATTERS: the Consistency Engine's whole promise is that it never
// tells a Case Handler what to do - only whether a proposed action deviates
// from this company's own historical pattern for similar cases, in either
// direction, and only once there is enough history to say anything at all.
// If it ever recommended an action, it would have quietly become a decision-
// maker instead of a check on one, which is a different (and much riskier)
// product than the one Rectifia sells. If it ever flagged with too little
// history, or flagged the wrong direction, it would either manufacture false
// pattern-matching pressure on a handler's judgment or point them the wrong
// way when it does apply.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import { checkConsistency, MIN_REFERENCE_CASES } from '../consistency/checkConsistency.js'

const REFERENCE_CASES_COLLECTION = 'referenceCases'
const CASES_COLLECTION = 'cases'

// The case fixtures below carry no `responses`, so deriveDepartmentTier()
// (functions/src/consistency/departmentTier.js) classifies them as
// 'unspecified' - reference cases must match that same tier to be found by
// findSimilarReferenceCases's equality filter.
function seedReferenceCase(firestore, id, overrides = {}) {
  firestore.seed(REFERENCE_CASES_COLLECTION, id, {
    companyId: 'company-1',
    category: 'harassment',
    department: 'unspecified',
    severityScore: 50,
    actionTaken: 'written_warning',
    ...overrides,
  })
}

function makeEvent({ before, after, caseId = 'RC-2026-0001' }) {
  const firestore = admin.firestore()
  // onDocumentUpdated only ever fires on a document that already exists;
  // seed it so event.data.after.ref.update() below has something to update.
  firestore.seed(CASES_COLLECTION, caseId, after)
  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)
  return {
    params: { caseId },
    data: {
      before: { data: () => before },
      after: { data: () => after, ref: caseRef },
    },
  }
}

const baseCase = {
  companyId: 'company-1',
  category: 'harassment',
  severityScore: 50,
  responses: [],
}

describe('consistencyFlag', () => {
  beforeEach(() => {
    admin.__reset()
  })

  it("below MIN_REFERENCE_CASES, returns 'insufficient data' and no flag", async () => {
    const firestore = admin.firestore()
    for (let i = 0; i < MIN_REFERENCE_CASES - 1; i += 1) {
      seedReferenceCase(firestore, `ref-${i}`)
    }

    const event = makeEvent({
      before: { ...baseCase, proposedAction: null },
      after: { ...baseCase, proposedAction: 'written_warning' },
    })

    await checkConsistency(event)

    const stored = firestore.peek(CASES_COLLECTION, 'RC-2026-0001')
    expect(stored.consistencyCheck.status).toBe('insufficient_data')
    expect(stored.consistencyCheck.flag).toBeUndefined()
  })

  it('above the floor, a harsher-than-typical proposed action flags with direction "harsher"', async () => {
    const firestore = admin.firestore()
    for (let i = 0; i < MIN_REFERENCE_CASES; i += 1) {
      seedReferenceCase(firestore, `ref-${i}`, { actionTaken: 'coaching' })
    }

    const event = makeEvent({
      before: { ...baseCase, proposedAction: null },
      after: { ...baseCase, proposedAction: 'suspension' },
    })

    await checkConsistency(event)

    const stored = firestore.peek(CASES_COLLECTION, 'RC-2026-0001')
    expect(stored.consistencyCheck.status).toBe('flagged')
    expect(stored.consistencyCheck.flag.direction).toBe('harsher')
    expect(stored.consistencyCheck.typicalAction).toBe('coaching')
  })

  it('above the floor, a more-lenient-than-typical proposed action flags with direction "lenient"', async () => {
    const firestore = admin.firestore()
    for (let i = 0; i < MIN_REFERENCE_CASES; i += 1) {
      seedReferenceCase(firestore, `ref-${i}`, { actionTaken: 'suspension' })
    }

    const event = makeEvent({
      before: { ...baseCase, proposedAction: null },
      after: { ...baseCase, proposedAction: 'coaching' },
    })

    await checkConsistency(event)

    const stored = firestore.peek(CASES_COLLECTION, 'RC-2026-0001')
    expect(stored.consistencyCheck.status).toBe('flagged')
    expect(stored.consistencyCheck.flag.direction).toBe('lenient')
    expect(stored.consistencyCheck.typicalAction).toBe('suspension')
  })

  it('above the floor, a proposed action matching the typical one is "consistent", not flagged', async () => {
    const firestore = admin.firestore()
    for (let i = 0; i < MIN_REFERENCE_CASES; i += 1) {
      seedReferenceCase(firestore, `ref-${i}`, { actionTaken: 'written_warning' })
    }

    const event = makeEvent({
      before: { ...baseCase, proposedAction: null },
      after: { ...baseCase, proposedAction: 'written_warning' },
    })

    await checkConsistency(event)

    const stored = firestore.peek(CASES_COLLECTION, 'RC-2026-0001')
    expect(stored.consistencyCheck.status).toBe('consistent')
    expect(stored.consistencyCheck.flag).toBeUndefined()
  })

  it('never writes a recommended action string, on any code path', async () => {
    const firestore = admin.firestore()
    for (let i = 0; i < MIN_REFERENCE_CASES; i += 1) {
      seedReferenceCase(firestore, `ref-${i}`, { actionTaken: 'coaching' })
    }

    const event = makeEvent({
      before: { ...baseCase, proposedAction: null },
      after: { ...baseCase, proposedAction: 'termination' },
    })

    await checkConsistency(event)

    const stored = firestore.peek(CASES_COLLECTION, 'RC-2026-0001')
    const serialized = JSON.stringify(stored.consistencyCheck)

    // The only vocabulary this module is allowed to surface is what
    // *happened* historically (typicalAction) and whether the proposal
    // deviates from it (flag.direction) - never a field that tells the
    // reader what they SHOULD do.
    expect(stored.consistencyCheck).not.toHaveProperty('recommendedAction')
    expect(stored.consistencyCheck).not.toHaveProperty('suggestedAction')
    expect(stored.consistencyCheck).not.toHaveProperty('recommendation')
    expect(serialized.toLowerCase()).not.toContain('recommend')
    expect(serialized.toLowerCase()).not.toContain('suggest')
    expect(serialized.toLowerCase()).not.toContain('should')
  })

  it('does nothing when proposedAction did not newly change', async () => {
    const firestore = admin.firestore()
    seedReferenceCase(firestore, 'ref-0')

    const event = makeEvent({
      before: { ...baseCase, proposedAction: 'written_warning' },
      after: { ...baseCase, proposedAction: 'written_warning' },
    })

    await checkConsistency(event)

    // The case doc itself exists (makeEvent seeds it, as it would already
    // exist for a real onDocumentUpdated to fire) - what must NOT happen is
    // a consistencyCheck being written onto it.
    const stored = firestore.peek(CASES_COLLECTION, 'RC-2026-0001')
    expect(stored.consistencyCheck).toBeUndefined()
  })
})
