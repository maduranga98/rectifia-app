// WHY THIS MATTERS: suspending a staff member used to be a plain client write
// of `status: 'suspended'` on companies/{companyId}/staff/{staffId}. Nothing
// in the authorization path ever read that field - firestore.rules trusts
// request.auth.token exclusively, and staffAuth.js only looked up the staff
// doc's `role` - so a "suspended" account kept a live Firebase Auth user with
// its role/companyId claims intact and went on signing in and working. The
// roster row went grey; the access did not change.
//
// These tests pin the two halves of the fix: setStaffStatus must disable the
// Firebase Auth user and revoke its refresh tokens (not just write the field),
// and loadCallerRole must refuse a suspended caller at the chokepoint every
// privileged callable already passes through.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import { setStaffStatus } from '../staff/setStaffStatus.js'
import { loadCallerRole } from '../utils/staffAuth.js'

const COMPANY_ID = 'company-1'
const ADMIN_UID = 'admin-1'
const STAFF_UID = 'handler-1'
const STAFF_PATH = `companies/${COMPANY_ID}/staff`

function seedCompany({ targetStatus = 'active', targetRole = 'caseHandler' } = {}) {
  const firestore = admin.__firestore()
  const auth = admin.__auth()
  firestore.seed(STAFF_PATH, ADMIN_UID, { role: 'companyAdmin', status: 'active', email: 'admin@acme.test' })
  firestore.seed(STAFF_PATH, STAFF_UID, { role: targetRole, status: targetStatus, email: 'handler@acme.test' })
  auth.seed(ADMIN_UID, { role: 'companyAdmin', companyId: COMPANY_ID })
  auth.seed(STAFF_UID, { role: targetRole, companyId: COMPANY_ID })
  return { firestore, auth }
}

function callAs(uid, claims, data) {
  return { auth: { uid, token: claims }, data }
}

const ADMIN_CLAIMS = { role: 'companyAdmin', companyId: COMPANY_ID }

describe('setStaffStatus', () => {
  beforeEach(() => {
    admin.__reset()
  })

  it('disables the Firebase Auth user and revokes its sessions, not just the roster field', async () => {
    const { firestore, auth } = seedCompany()

    await setStaffStatus(
      callAs(ADMIN_UID, ADMIN_CLAIMS, { companyId: COMPANY_ID, staffId: STAFF_UID, status: 'suspended' })
    )

    // The whole point of the fix: the account itself is locked, so the
    // suspended member cannot sign in again...
    expect(auth.record(STAFF_UID).disabled).toBe(true)
    // ...and any session already open dies on its next token refresh rather
    // than running for another hour.
    expect(auth.record(STAFF_UID).revokeCount).toBe(1)
    expect(firestore.peek(STAFF_PATH, STAFF_UID).status).toBe('suspended')
  })

  it('re-enables the account on reactivation', async () => {
    const { firestore, auth } = seedCompany({ targetStatus: 'suspended' })
    auth.record(STAFF_UID).disabled = true

    await setStaffStatus(
      callAs(ADMIN_UID, ADMIN_CLAIMS, { companyId: COMPANY_ID, staffId: STAFF_UID, status: 'active' })
    )

    expect(auth.record(STAFF_UID).disabled).toBe(false)
    expect(firestore.peek(STAFF_PATH, STAFF_UID).status).toBe('active')
    expect(firestore.peek(STAFF_PATH, STAFF_UID).suspendedAt).toBeNull()
  })

  it('refuses a caller who is not a staff manager of the company', async () => {
    seedCompany()

    await expect(
      setStaffStatus(
        callAs(STAFF_UID, { role: 'caseHandler', companyId: COMPANY_ID }, {
          companyId: COMPANY_ID,
          staffId: ADMIN_UID,
          status: 'suspended',
        })
      )
    ).rejects.toMatchObject({ code: 'permission-denied' })
    expect(admin.__auth().record(ADMIN_UID).disabled).toBe(false)
  })

  it('refuses a caller whose company claim is for another company', async () => {
    seedCompany()

    await expect(
      setStaffStatus(
        callAs(ADMIN_UID, { role: 'companyAdmin', companyId: 'other-company' }, {
          companyId: COMPANY_ID,
          staffId: STAFF_UID,
          status: 'suspended',
        })
      )
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('refuses to suspend the last active Company Admin', async () => {
    // The caller here is a staffManagement custom-role holder rather than an
    // admin - the second writer firestore.rules used to allow through the
    // direct `status` write, so this covers that authorization path too - and
    // the target is the company's only active Company Admin.
    const { firestore, auth } = seedCompany({ targetRole: 'companyAdmin' })
    firestore.seed(STAFF_PATH, ADMIN_UID, { role: null, customRoleId: 'role-1', status: 'active' })
    firestore.seed(`companies/${COMPANY_ID}/customRoles`, 'role-1', {
      name: 'People ops',
      permissions: ['staffManagement'],
    })
    auth.seed(ADMIN_UID, { customRoleId: 'role-1', companyId: COMPANY_ID })

    await expect(
      setStaffStatus(
        callAs(ADMIN_UID, { customRoleId: 'role-1', companyId: COMPANY_ID }, {
          companyId: COMPANY_ID,
          staffId: STAFF_UID,
          status: 'suspended',
        })
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(auth.record(STAFF_UID).disabled).toBe(false)

    // With a second active admin on the roster the same call goes through -
    // proving the refusal above was the last-admin guard, not the caller's
    // custom role being rejected outright.
    firestore.seed(STAFF_PATH, 'admin-2', { role: 'companyAdmin', status: 'active' })
    await setStaffStatus(
      callAs(ADMIN_UID, { customRoleId: 'role-1', companyId: COMPANY_ID }, {
        companyId: COMPANY_ID,
        staffId: STAFF_UID,
        status: 'suspended',
      })
    )
    expect(auth.record(STAFF_UID).disabled).toBe(true)
  })

  it('refuses a self-flip', async () => {
    seedCompany()

    await expect(
      setStaffStatus(
        callAs(ADMIN_UID, ADMIN_CLAIMS, { companyId: COMPANY_ID, staffId: ADMIN_UID, status: 'suspended' })
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' })
  })

  it('rejects a status outside active/suspended', async () => {
    seedCompany()

    await expect(
      setStaffStatus(
        callAs(ADMIN_UID, ADMIN_CLAIMS, { companyId: COMPANY_ID, staffId: STAFF_UID, status: 'deleted' })
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})

describe('loadCallerRole', () => {
  beforeEach(() => {
    admin.__reset()
  })

  it('refuses a suspended staff member at the privileged-callable chokepoint', async () => {
    const { firestore } = seedCompany({ targetStatus: 'suspended' })

    await expect(loadCallerRole(firestore, COMPANY_ID, STAFF_UID, 'case_handler_action')).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('still resolves an active staff member', async () => {
    const { firestore } = seedCompany()

    await expect(loadCallerRole(firestore, COMPANY_ID, STAFF_UID, 'case_handler_action')).resolves.toBe('caseHandler')
  })
})
