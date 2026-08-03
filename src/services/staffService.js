import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const inviteStaffCallable = httpsCallable(functions, 'inviteStaff')

// Invites a new staff member: creates their auth account, stamps role +
// companyId as custom claims, and queues a set-your-password link (see
// functions/src/staff/inviteStaff.js). Only a signed-in Company Admin can
// call this successfully - the function itself re-checks the actor's custom
// claims server-side, this is not a client-side-only gate.
export async function inviteStaff({ companyId, email, role, actorId }) {
  if (!companyId || !email || !role) {
    throw new Error('companyId, email, and role are required')
  }
  const result = await inviteStaffCallable({ companyId, email, role, actorId })
  return result.data
}
