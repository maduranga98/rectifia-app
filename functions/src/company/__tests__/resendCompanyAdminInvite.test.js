// WHY THIS MATTERS: the whole point of the Company Admin handover is that no
// password is ever spoken aloud - the admin sets their own through a link.
// That link is a Firebase password-reset action code, so it expires, and the
// re-send is the only thing standing between an expired link and a Super
// Admin reading a password down the phone. Picking the wrong record breaks
// that: re-inviting an admin who already has a password would hand a
// password-reset link to someone who never asked for one, and silently
// picking one of several pending admins would send it to the wrong person.
import { describe, it, expect } from 'vitest'
import { selectPendingCompanyAdmin } from '../resendCompanyAdminInvite.js'

const PENDING = { id: 'admin-1', email: 'a@example.com', status: 'invited' }
const ACTIVE = { id: 'admin-2', email: 'b@example.com', status: 'active' }

describe('selectPendingCompanyAdmin', () => {
  it('picks the single admin who has not set a password yet', () => {
    expect(selectPendingCompanyAdmin([ACTIVE, PENDING])).toEqual({ admin: PENDING })
  })

  it('refuses when every admin has already accepted', () => {
    const result = selectPendingCompanyAdmin([ACTIVE])
    expect(result.admin).toBeUndefined()
    expect(result.error.code).toBe('failed-precondition')
    expect(result.error.message).toMatch(/already set a password/)
  })

  it('refuses when the company has no admin record at all', () => {
    const result = selectPendingCompanyAdmin([])
    expect(result.error.code).toBe('failed-precondition')
    expect(result.error.message).toMatch(/no Company Admin account/)
  })

  it('refuses to guess between two pending admins', () => {
    const other = { id: 'admin-3', email: 'c@example.com', status: 'invited' }
    const result = selectPendingCompanyAdmin([PENDING, other])
    expect(result.error.code).toBe('failed-precondition')
    expect(result.error.message).toMatch(/more than one pending/)
  })

  it('uses an explicit staffId to disambiguate', () => {
    const other = { id: 'admin-3', email: 'c@example.com', status: 'invited' }
    expect(selectPendingCompanyAdmin([PENDING, other], 'admin-3')).toEqual({ admin: other })
  })

  it('will not re-invite a named admin who already accepted', () => {
    const result = selectPendingCompanyAdmin([PENDING, ACTIVE], 'admin-2')
    expect(result.error.code).toBe('failed-precondition')
    expect(result.error.message).toMatch(/already set their password/)
  })

  it('reports a staffId that is not an admin of this company as not-found', () => {
    const result = selectPendingCompanyAdmin([PENDING], 'nobody')
    expect(result.error.code).toBe('not-found')
  })
})
