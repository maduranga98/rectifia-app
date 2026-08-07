// WHY THIS MATTERS: 'anonymous' vs 'confidential' is the single promise the
// whole intake system is sold on - a reporter who chooses anonymous is told
// there is nothing on their case that identifies them, not even encrypted,
// not even for a Super Admin with a documented reason. If an anonymous
// submission ever wrote an identity record (or a contact-channel record) by
// accident - a copy-paste from the confidential path, a default that should
// have been null - that promise would be false the moment the case was
// filed, silently, with no error for anyone to notice. And if a confidential
// case's identity were ever stored as plaintext, or duplicated across more
// than one record, the encryption boundary the rest of the system relies on
// (identityVault.js's split-key access, the identity access audit log) would
// be protecting nothing.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import { submitCase } from '../intake/submitCase.js'
import { createCaseOnBehalf } from '../intake/createCaseOnBehalf.js'
import { compileReport } from '../intake/generateReport.js'
import { decryptIdentity } from '../utils/identityVault.js'

const COMPANIES_COLLECTION = 'companies'
const CASES_COLLECTION = 'cases'
const STAFF_SUBCOLLECTION = 'staff'

function seedCompany(firestore, companyId, overrides = {}) {
  firestore.seed(COMPANIES_COLLECTION, companyId, {
    slug: 'acme',
    name: 'Acme Co',
    departments: [],
    ...overrides,
  })
}

function seedIntakeStaff(firestore, companyId, uid, role = 'caseHandler') {
  firestore.seed(`${COMPANIES_COLLECTION}/${companyId}/${STAFF_SUBCOLLECTION}`, uid, { role })
}

function baseRequest(data, auth) {
  return { data, auth, rawRequest: { headers: {}, ip: '203.0.113.5' } }
}

// submitCase.js requires this on every reporter self-submission (see
// requireDataHandlingAcknowledgment there) - it is a separate invariant from
// identity tier, so this suite just satisfies the requirement with a valid
// fixture rather than asserting on it.
const VALID_ACKNOWLEDGMENT = {
  acknowledged: true,
  acknowledgedAt: '2026-08-07T00:00:00.000Z',
  policyVersion: 'privacy-test-fixture',
}

describe('identityTier', () => {
  beforeEach(() => {
    admin.__reset()
  })

  describe('reporter self-submission (submitCase)', () => {
    it("an 'anonymous' tier submission writes no reporterIdentity and no contactEmail field", async () => {
      const firestore = admin.firestore()
      seedCompany(firestore, 'company-1')

      const result = await submitCase(
        baseRequest({
          category: 'harassment',
          responses: [{ questionId: 'incident_description', value: 'Something happened.' }],
          companySlug: 'acme',
          tier: 'anonymous',
          dataHandlingAcknowledgment: VALID_ACKNOWLEDGMENT,
        })
      )

      const stored = firestore.peek(CASES_COLLECTION, result.caseId)
      expect(stored.tier).toBe('anonymous')
      expect(Object.prototype.hasOwnProperty.call(stored, 'reporterIdentity')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(stored, 'contactEmail')).toBe(false)
      // The auditable record of the pre-submission notice - a boolean, a
      // timestamp, and the policy version, never anything identity-bearing.
      expect(stored.dataHandlingAcknowledgment).toEqual(VALID_ACKNOWLEDGMENT)
    })

    it('is refused without a data-handling acknowledgment, even with a valid tier', async () => {
      const firestore = admin.firestore()
      seedCompany(firestore, 'company-1')

      await expect(
        submitCase(
          baseRequest({
            category: 'harassment',
            responses: [{ questionId: 'incident_description', value: 'Something happened.' }],
            companySlug: 'acme',
            tier: 'anonymous',
            // No dataHandlingAcknowledgment at all.
          })
        )
      ).rejects.toThrow(/data-handling notice/)
    })

    it("a 'confidential' tier self-submission ALSO writes no reporterIdentity - this form never collects one", async () => {
      // submitCase.js never asks a self-reporting reporter for a name/email;
      // 'confidential' here only records their standing choice. There is
      // nothing to vault until createCaseOnBehalf.js or
      // identityTransition.js's upgradeToConfidential supplies details.
      const firestore = admin.firestore()
      seedCompany(firestore, 'company-1')

      const result = await submitCase(
        baseRequest({
          category: 'harassment',
          responses: [{ questionId: 'incident_description', value: 'Something happened.' }],
          companySlug: 'acme',
          tier: 'confidential',
          dataHandlingAcknowledgment: VALID_ACKNOWLEDGMENT,
        })
      )

      const stored = firestore.peek(CASES_COLLECTION, result.caseId)
      expect(stored.tier).toBe('confidential')
      expect(Object.prototype.hasOwnProperty.call(stored, 'reporterIdentity')).toBe(false)
    })
  })

  describe('staff-filed submission (createCaseOnBehalf)', () => {
    it("an 'anonymous' tier case writes no reporterIdentity, even when the caller supplies identity fields", async () => {
      const firestore = admin.firestore()
      seedCompany(firestore, 'company-1')
      seedIntakeStaff(firestore, 'company-1', 'staff-uid-1')

      const result = await createCaseOnBehalf(
        baseRequest(
          {
            category: 'harassment',
            responses: [{ questionId: 'incident_description', value: 'Reported by phone.' }],
            tier: 'anonymous',
            intakeMethod: 'phone',
            reportedAt: Date.now(),
            reporterInformedOfTier: true,
            // Anonymous tier ignores this entirely - buildIdentityPayload is
            // never even called for it (see createCaseOnBehalf.js).
            reporterIdentity: { name: 'Jane Reporter', email: 'jane@example.com' },
          },
          { uid: 'staff-uid-1', token: { companyId: 'company-1', email: 'staff@acme.example' } }
        )
      )

      const stored = firestore.peek(CASES_COLLECTION, result.caseId)
      expect(stored.tier).toBe('anonymous')
      expect(Object.prototype.hasOwnProperty.call(stored, 'reporterIdentity')).toBe(false)
    })

    it("a 'confidential' tier case writes EXACTLY ONE encrypted vault record, not plaintext-readable", async () => {
      const firestore = admin.firestore()
      seedCompany(firestore, 'company-1')
      seedIntakeStaff(firestore, 'company-1', 'staff-uid-1')

      const plaintextName = 'Jane Reporter'
      const plaintextEmail = 'jane@example.com'

      const result = await createCaseOnBehalf(
        baseRequest(
          {
            category: 'harassment',
            responses: [{ questionId: 'incident_description', value: 'Reported by phone.' }],
            tier: 'confidential',
            intakeMethod: 'phone',
            reportedAt: Date.now(),
            reporterInformedOfTier: true,
            reporterIdentity: { name: plaintextName, email: plaintextEmail },
          },
          { uid: 'staff-uid-1', token: { companyId: 'company-1', email: 'staff@acme.example' } }
        )
      )

      const stored = firestore.peek(CASES_COLLECTION, result.caseId)

      // Exactly one identity record, and it is a real AES-GCM envelope, not a
      // plaintext copy or a second field carrying the same data.
      expect(stored.reporterIdentity).toBeDefined()
      const { vault } = stored.reporterIdentity
      expect(vault).toHaveProperty('ciphertext')
      expect(vault).toHaveProperty('iv')
      expect(vault).toHaveProperty('authTag')

      const serializedCase = JSON.stringify(stored)
      expect(serializedCase).not.toContain(plaintextName)
      expect(serializedCase).not.toContain(plaintextEmail)
      // The ciphertext is base64, not JSON - it cannot be parsed back into
      // the plaintext shape without the key.
      expect(() => JSON.parse(Buffer.from(vault.ciphertext, 'base64').toString('utf8'))).toThrow()

      // Round-trip through the real, authorized decrypt path proves the
      // envelope is genuinely recoverable (not corrupted) with the key -
      // and only with an authorization, reason, and caseId supplied.
      const recovered = await decryptIdentity({
        envelope: vault,
        authorizedAs: 'assignedHandler',
        actorUid: 'staff-uid-1',
        reason: 'Test suite verifying the vault round-trips correctly.',
        caseId: result.caseId,
        firestore,
      })
      expect(recovered).toEqual({ name: plaintextName, email: plaintextEmail })
    })
  })

  describe('generateReport identity section (compileReport)', () => {
    async function seedAssignedCase(firestore, caseId, caseData) {
      firestore.seed(CASES_COLLECTION, caseId, {
        companyId: 'company-1',
        assignedHandlerId: 'handler-uid-1',
        category: 'harassment',
        status: 'open',
        ...caseData,
      })
      seedIntakeStaff(firestore, 'company-1', 'handler-uid-1', 'caseHandler')
    }

    it("an 'anonymous' case's report has no identity section at all", async () => {
      const firestore = admin.firestore()
      await seedAssignedCase(firestore, 'RC-2026-0001', { tier: 'anonymous' })

      const { report } = await compileReport(firestore, 'RC-2026-0001', 'handler-uid-1')

      expect(report.restrictedReporterIdentity).toBeUndefined()
      expect(JSON.stringify(report)).not.toContain('restrictedReporterIdentity')
    })

    it("a case with no tier at all (pre-dates the field) also has no identity section", async () => {
      const firestore = admin.firestore()
      await seedAssignedCase(firestore, 'RC-2026-0002', { tier: undefined })

      const { report } = await compileReport(firestore, 'RC-2026-0002', 'handler-uid-1')

      expect(report.restrictedReporterIdentity).toBeUndefined()
    })

    it("a 'confidential' case's report states an identity is on file, never its plaintext or ciphertext", async () => {
      const firestore = admin.firestore()
      await seedAssignedCase(firestore, 'RC-2026-0003', {
        tier: 'confidential',
        reporterIdentity: {
          vault: { ciphertext: 'c2VjcmV0Y2lwaGVy', iv: 'aXY=', authTag: 'dGFn' },
          fieldsOnFile: ['name', 'email'],
        },
      })

      const { report } = await compileReport(firestore, 'RC-2026-0003', 'handler-uid-1')

      expect(report.restrictedReporterIdentity).toBeDefined()
      expect(report.restrictedReporterIdentity.status).toMatch(/encrypted/i)
      const serializedReport = JSON.stringify(report)
      expect(serializedReport).not.toContain('c2VjcmV0Y2lwaGVy')
    })
  })
})
