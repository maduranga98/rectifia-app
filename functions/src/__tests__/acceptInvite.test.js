// WHY THIS MATTERS: a Company Admin clicking their emailed invite link got a
// 401 from this callable, and because AcceptInvitePage wrapped the whole
// acceptance in one try/catch, that 401 surfaced as "could not set your
// password" - on a password that had just been set successfully, against an
// oobCode confirmPasswordReset had already burned. Every retry then died at
// step one with a 400, so the admin was stranded on a page while a perfectly
// usable account sat behind /login.
//
// The server half of that fix is here: companyId is read off
// request.auth.token, which is only a snapshot of the claims as of token
// minting. These tests pin that a caller whose token lacks the claim is
// resolved from the claims actually stamped on the account rather than
// refused, and that the genuinely unprovisioned caller is still refused -
// with a code that says which of the two it is.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import { acceptInvite } from '../staff/acceptInvite.js'

const COMPANY_ID = 'company-1'
const UID = 'admin-uid-1'

function seedInvitedAdmin() {
  const firestore = admin.__firestore()
  firestore.seed('companies', COMPANY_ID, { name: 'Acme Corp' })
  firestore
    .collection('companies')
    .doc(COMPANY_ID)
    .collection('staff')
    .doc(UID)
    .set({ email: 'admin@acme.test', role: 'companyAdmin', status: 'invited' })
  return firestore
}

async function readStaff(firestore) {
  const snapshot = await firestore
    .collection('companies')
    .doc(COMPANY_ID)
    .collection('staff')
    .doc(UID)
    .get()
  return snapshot.data()
}

describe('acceptInvite', () => {
  beforeEach(() => {
    admin.__reset()
  })

  it('activates the staff doc when the token carries companyId', async () => {
    const firestore = seedInvitedAdmin()
    admin.__auth().seed(UID, { role: 'companyAdmin', companyId: COMPANY_ID })

    const result = await acceptInvite({
      auth: { uid: UID, token: { companyId: COMPANY_ID } },
    })

    expect(result).toMatchObject({ success: true })
    expect((await readStaff(firestore)).status).toBe('active')
  })

  // The regression itself: the token is stale/claimless but the account is
  // fully provisioned. Before the fix this threw 'unauthenticated' (HTTP 401),
  // which is what the invited admin saw in the browser console.
  it('falls back to the claims stamped on the account when the token has no companyId', async () => {
    const firestore = seedInvitedAdmin()
    admin.__auth().seed(UID, { role: 'companyAdmin', companyId: COMPANY_ID })

    const result = await acceptInvite({ auth: { uid: UID, token: {} } })

    expect(result).toMatchObject({ success: true })
    expect((await readStaff(firestore)).status).toBe('active')
  })

  it('leaves the stamped custom claims untouched', async () => {
    seedInvitedAdmin()
    const claims = { role: 'manager', companyId: COMPANY_ID, departments: ['Sales'] }
    admin.__auth().seed(UID, claims)

    await acceptInvite({ auth: { uid: UID, token: {} } })

    expect(admin.__auth().record(UID).customClaims).toEqual(claims)
  })

  it('is idempotent once the doc is already active', async () => {
    const firestore = seedInvitedAdmin()
    admin.__auth().seed(UID, { role: 'companyAdmin', companyId: COMPANY_ID })

    await acceptInvite({ auth: { uid: UID, token: { companyId: COMPANY_ID } } })
    const result = await acceptInvite({ auth: { uid: UID, token: { companyId: COMPANY_ID } } })

    expect(result).toMatchObject({ success: true, alreadyActive: true })
    expect((await readStaff(firestore)).status).toBe('active')
  })

  it('refuses an unauthenticated caller', async () => {
    await expect(acceptInvite({})).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  // Distinct from 'unauthenticated' on purpose: the client retries an
  // unauthenticated answer behind a forced token refresh, which can never help
  // an account that has no companyId claim anywhere to refresh into.
  it('refuses a caller with no companyId on the token or the account', async () => {
    admin.__auth().seed(UID, { role: 'companyAdmin' })

    await expect(acceptInvite({ auth: { uid: UID, token: {} } })).rejects.toMatchObject({
      code: 'failed-precondition',
    })
  })

  it('refuses a caller whose Auth record no longer exists', async () => {
    await expect(acceptInvite({ auth: { uid: 'ghost', token: {} } })).rejects.toMatchObject({
      code: 'failed-precondition',
    })
  })

  it('reports a missing staff doc as not-found', async () => {
    admin.__auth().seed(UID, { role: 'companyAdmin', companyId: COMPANY_ID })

    await expect(acceptInvite({ auth: { uid: UID, token: {} } })).rejects.toMatchObject({
      code: 'not-found',
    })
  })
})
