// WHY THIS MATTERS: moving a Case Handler out of that role must not silently
// orphan a case they're still assigned to. listCaseHandlers()
// (src/services/routingService.js) filters strictly on role === 'caseHandler'
// at read time, so a former handler drops out of every picklist while
// assignedHandlerId on their open case still points at them - the case
// becomes invisible to normal reassignment flows. This guard mirrors
// removeStaffMember.js's existing openCaseCount check exactly, just at the
// role-change write path instead of the delete path.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import { assignStaffRole } from '../assignStaffRole.js'

const COMPANY_ID = 'company-1'
const ADMIN_UID = 'admin-1'
const STAFF_ID = 'staff-1'

function seedCompanyAdmin(uid = ADMIN_UID, companyId = COMPANY_ID) {
  admin.auth().seed(uid, { role: 'companyAdmin', companyId })
}

function seedStaff({ staffId = STAFF_ID, companyId = COMPANY_ID, role = 'caseHandler' } = {}) {
  admin.auth().seed(staffId, { role, companyId })
  admin.firestore().seed(`companies/${companyId}/staff`, staffId, { role })
}

function seedCase(caseId, { companyId = COMPANY_ID, assignedHandlerId = STAFF_ID, status = 'assigned' } = {}) {
  admin.firestore().seed('cases', caseId, { companyId, assignedHandlerId, status })
}

function baseRequest(overrides = {}) {
  return {
    auth: { uid: ADMIN_UID },
    data: { companyId: COMPANY_ID, staffId: STAFF_ID, ...overrides },
  }
}

describe('assignStaffRole - open case guard on role change', () => {
  beforeEach(() => {
    admin.__reset()
    seedCompanyAdmin()
  })

  it('changing a Case Handler role with 0 open cases succeeds', async () => {
    seedStaff({ role: 'caseHandler' })

    const result = await assignStaffRole(baseRequest({ role: 'hrCoordinator' }))

    expect(result).toEqual({ success: true, staffId: STAFF_ID, role: 'hrCoordinator' })
    const staffDoc = admin.firestore().peek(`companies/${COMPANY_ID}/staff`, STAFF_ID)
    expect(staffDoc.role).toBe('hrCoordinator')
  })

  it('changing a Case Handler role with 1+ open cases throws failed-precondition with openCaseCount', async () => {
    seedStaff({ role: 'caseHandler' })
    seedCase('case-1', { status: 'assigned' })
    seedCase('case-2', { status: 'in_review' })

    await expect(assignStaffRole(baseRequest({ role: 'hrCoordinator' }))).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { openCaseCount: 2 },
    })

    // no write should have happened
    const staffDoc = admin.firestore().peek(`companies/${COMPANY_ID}/staff`, STAFF_ID)
    expect(staffDoc.role).toBe('caseHandler')
  })

  it('a closed case assigned to them does not block the role change', async () => {
    seedStaff({ role: 'caseHandler' })
    seedCase('case-1', { status: 'closed' })

    const result = await assignStaffRole(baseRequest({ role: 'hrCoordinator' }))

    expect(result).toEqual({ success: true, staffId: STAFF_ID, role: 'hrCoordinator' })
  })

  it('changing a non-Case-Handler role is never blocked, even with a stray assignedHandlerId pointing at them', async () => {
    seedStaff({ role: 'hrCoordinator' })
    seedCase('case-1', { assignedHandlerId: STAFF_ID, status: 'assigned' })

    const result = await assignStaffRole(baseRequest({ role: 'pulseCheckReviewer' }))

    expect(result).toEqual({ success: true, staffId: STAFF_ID, role: 'pulseCheckReviewer' })
  })

  it('moving someone INTO caseHandler from another role is never blocked', async () => {
    seedStaff({ role: 'hrCoordinator' })
    seedCase('case-1', { assignedHandlerId: STAFF_ID, status: 'assigned' })

    const result = await assignStaffRole(baseRequest({ role: 'caseHandler' }))

    expect(result).toEqual({ success: true, staffId: STAFF_ID, role: 'caseHandler' })
  })

  it('a no-op "change" to the same role (caseHandler -> caseHandler) is never blocked by open cases', async () => {
    seedStaff({ role: 'caseHandler' })
    seedCase('case-1', { status: 'assigned' })

    const result = await assignStaffRole(baseRequest({ role: 'caseHandler' }))

    expect(result).toEqual({ success: true, staffId: STAFF_ID, role: 'caseHandler' })
  })

  it('moving a Case Handler with open cases to a custom role is blocked too', async () => {
    seedStaff({ role: 'caseHandler' })
    admin.firestore().seed(`companies/${COMPANY_ID}/customRoles`, 'custom-1', { name: 'Custom Role' })
    seedCase('case-1', { status: 'assigned' })

    await expect(
      assignStaffRole(baseRequest({ role: undefined, customRoleId: 'custom-1' }))
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { openCaseCount: 1 },
    })
  })
})
