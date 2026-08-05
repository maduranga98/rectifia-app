const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')
const { encryptionKeySecret, decryptIdentity } = require('../utils/identityVault')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const SUPER_ADMINS_COLLECTION = 'superAdmins'

// The entire decryptable surface. A reveal call names a case and ONE of these
// field names - there is deliberately no "decrypt arbitrary field" path, so a
// new confidential field can only be exposed here by an explicit edit to this
// allowlist, never by being added upstream. Today the only vaulted field is
// reporterIdentity (createCaseOnBehalf.js).
const REVEALABLE_FIELDS = new Set(['reporterIdentity'])

// Super Admin is superAdmins/{uid} allowlist membership, not a custom claim -
// the exact fact the old identityVault role check got wrong. Checked with the
// Admin SDK, which bypasses the (deny-all) client rule on that collection.
async function isSuperAdmin(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

// Reveals a confidential reporter's identity to someone entitled to see it,
// with a logged reason. Blueprint §7.1: the assigned investigator may do this
// on their own case; a platform Super Admin may do it on any case. Both grants
// are resolved here - server-side, from the verified auth uid, never a
// client-supplied id - and the resolved grant string is what the vault records
// on the audit entry. The vault itself stays policy-free (see identityVault.js).
//
// The plaintext is returned in the callable response and nowhere else: it is
// never written back onto the case, the thread, the report, or any log field.
// The only durable trace of a reveal is the identityAccessAuditLog entry the
// vault writes, which records who/when/case/reason - not the value.
exports.revealIdentity = onCall({ secrets: [encryptionKeySecret] }, async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, field = 'reporterIdentity', reason } = request.data || {}

  if (!REVEALABLE_FIELDS.has(field)) {
    throw new HttpsError('invalid-argument', 'That field cannot be revealed')
  }

  const firestore = admin.firestore()

  // Resolve authorization before anything is decrypted. A Super Admin is
  // permitted on any case; anyone else must be the case's assigned handler,
  // which loadCaseForHandler verifies against the staff record keyed by the
  // auth uid (throwing permission-denied otherwise) rather than trusting the
  // request. Either path yields the case snapshot we then read the tier and
  // envelope from.
  let authorizedAs
  let snapshot
  if (await isSuperAdmin(firestore, uid)) {
    authorizedAs = 'superAdmin'
    if (!caseId) {
      throw new HttpsError('invalid-argument', 'caseId is required')
    }
    snapshot = await firestore.collection(CASES_COLLECTION).doc(caseId).get()
    if (!snapshot.exists) {
      throw new HttpsError('not-found', 'No such case')
    }
  } else {
    // Throws permission-denied unless this is the handler the case is
    // assigned to.
    const loaded = await loadCaseForHandler(firestore, caseId, uid)
    authorizedAs = 'assignedHandler'
    snapshot = loaded.snapshot
  }

  const caseData = snapshot.data()

  // An anonymous-tier case has nothing vaulted. Refuse explicitly - even for a
  // Super Admin - rather than returning an empty result that could read as "no
  // identity found" when the truth is "this tier never holds one".
  if (caseData.tier !== 'confidential') {
    throw new HttpsError(
      'permission-denied',
      'This case is not confidential tier, so it has no reporter identity to reveal'
    )
  }

  // Confidential tier but nothing on file: a self-submitted report
  // (submitCase.js records the tier choice but vaults no identity). Distinct
  // from the anonymous case above, and distinct from an identity that exists
  // and is being withheld - so it gets its own not-found, not a decrypt error.
  const envelope = caseData[field]?.vault ?? null
  if (!envelope) {
    throw new HttpsError('not-found', 'No reporter identity is on file for this case')
  }

  // The vault enforces the reason length and caseId requirement and writes the
  // audit entry (granted or denied). A short/absent reason is denied here, by
  // the vault, for every caller including a Super Admin.
  const identity = await decryptIdentity({
    envelope,
    authorizedAs,
    actorUid: uid,
    actorEmail: request.auth?.token?.email ?? null,
    reason,
    caseId,
    field,
    firestore,
  })

  return { field, identity }
})
