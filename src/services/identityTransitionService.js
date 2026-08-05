import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const upgradeToConfidentialCallable = httpsCallable(functions, 'upgradeToConfidential')
const addContactEmailCallable = httpsCallable(functions, 'addContactEmail')
const removeContactEmailCallable = httpsCallable(functions, 'removeContactEmail')

// The two reporter-initiated transitions from Blueprint §7.2 and §8, wrapped
// the same thin way caseThreadService.js wraps the thread callables: the case
// document is not client-readable or writable, so none of this is a Firestore
// write - each function is a callable that re-verifies the Case ID and
// passcode server-side, exactly as posting a message does.
//
// There is no staff-side counterpart in this file and there is not meant to be
// one. Both actions are the reporter's alone.

// Moves a case from anonymous to confidential tier and vaults the details the
// reporter chose to give. `identity` is a subset of
// { name, email, phone, jobTitle, notes } - the same field set a staff-filed
// confidential case uses - and at least one must be non-empty.
//
// Irreversible, and the panel that calls this says so before the reporter
// commits: once the details are in the vault they are part of a live
// investigation's record. Returns { tier, changed, fieldsOnFile }; `changed`
// is false when the case was already confidential, which the server treats as
// a no-op rather than an error.
export async function upgradeToConfidential(caseId, passcode, identity) {
  const hasSomething = Object.values(identity ?? {}).some(
    (value) => typeof value === 'string' && value.trim().length > 0
  )
  if (!hasSomething) {
    throw new Error('Enter at least one detail before continuing')
  }
  const result = await upgradeToConfidentialCallable({ caseId, passcode, identity })
  return result.data
}

// Stores an encrypted contact address for update notifications. This does NOT
// change the case's tier - staff cannot read the address in any form - but it
// does create a stored mapping between that address and this case, which is
// the thing "anonymous" otherwise guarantees does not exist. The panel states
// that plainly before the field is shown; do not call this from anywhere that
// does not.
export async function addContactEmail(caseId, passcode, email) {
  if (!email?.trim()) {
    throw new Error('Enter an email address')
  }
  const result = await addContactEmailCallable({ caseId, passcode, email: email.trim() })
  return result.data
}

// Deletes the stored address. Unlike the identity upgrade this is genuinely
// reversible, because an address is a delivery detail rather than evidence -
// the ciphertext is removed from the case document, not flagged as inactive.
export async function removeContactEmail(caseId, passcode) {
  const result = await removeContactEmailCallable({ caseId, passcode })
  return result.data
}
