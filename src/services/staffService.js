import { httpsCallable } from 'firebase/functions'
import { auth, functions } from './firebase'

const inviteStaffCallable = httpsCallable(functions, 'inviteStaff')
const updateStaffDepartmentsCallable = httpsCallable(functions, 'updateStaffDepartments')
const removeStaffMemberCallable = httpsCallable(functions, 'removeStaffMember')

// Invites a new staff member: creates their auth account, stamps either a
// fixed role or a customRoleId (never both) plus companyId as custom claims,
// and queues a set-your-password link (see functions/src/staff/inviteStaff.js).
// Only a signed-in Company Admin can call this successfully - the function
// itself re-checks the actor's custom claims server-side, this is not a
// client-side-only gate.
//
// `departments` is the manager pulse-visibility scope: an array of department
// name strings, stamped into the manager's `departments` custom claim. It is
// only meaningful for role === 'manager' (the server ignores it otherwise), and
// the names must be the exact strings the pulse summaries carry - see
// firestore.rules' pulseSummaries clause.
export async function inviteStaff({ companyId, email, role, customRoleId, actorId, departments }) {
  if (!companyId || !email || (!role && !customRoleId)) {
    throw new Error('companyId, email, and either role or customRoleId are required')
  }
  const result = await inviteStaffCallable({ companyId, email, role, customRoleId, actorId, departments })
  return result.data
}

// Sets the `departments` scope claim on an existing staff member without
// re-inviting them - the migration path for managers who predate the claim.
// Only a Company Admin for the company can call this (re-checked server-side).
// The server revokes the target's refresh tokens so the new claim takes effect
// on their next request; we additionally force-refresh the *caller's* own token
// so anything reading claims in this session is not left stale either.
export async function updateStaffDepartments({ companyId, staffId, departments }) {
  if (!companyId || !staffId) {
    throw new Error('companyId and staffId are required')
  }
  const result = await updateStaffDepartmentsCallable({ companyId, staffId, departments })
  if (auth.currentUser) {
    await auth.currentUser.getIdToken(true)
  }
  return result.data
}

// Removes a staff member's account entirely - Auth user, custom claims, and
// the Firestore record - never a bare `deleteDoc` on the staff doc (that
// would leave the Auth account and its claims intact; see
// functions/src/staff/removeStaffMember.js). The callable itself refuses if
// the target is the last active Company Admin or is still the assigned
// handler on an open case, surfacing either as an ordinary thrown Error.
export async function removeStaffMember({ companyId, staffId }) {
  if (!companyId || !staffId) {
    throw new Error('companyId and staffId are required')
  }
  const result = await removeStaffMemberCallable({ companyId, staffId })
  return result.data
}
