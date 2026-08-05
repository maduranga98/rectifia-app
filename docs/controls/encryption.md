# Encryption

## Control

Data is encrypted in transit everywhere, at rest by the underlying platform
everywhere, and additionally at the application layer for the one field
category where platform-level encryption alone is not enough: reporter
identity and contact data. Encryption keys are tracked, aged, and rotatable
without a bulk plaintext exposure.

## Implementation

**In transit.** Every client-to-server path is HTTPS/TLS, enforced by
Firebase Hosting, Cloud Functions, and the Firebase client SDKs - there is no
HTTP fallback anywhere in this deployment.

**At rest, platform-level.** Firestore and Cloud Storage encrypt all data at
rest by default (Google-managed encryption keys), covering every document
and object in this app, including ones this document doesn't call out
individually.

**At rest, application-level - the identity vault.** Reporter identity
(`reporterIdentity`) and an optional contact address (`contactEmail`) are
additionally encrypted with AES-256-GCM before they ever reach Firestore,
via [`functions/src/utils/identityVault.js`](../../functions/src/utils/identityVault.js).
The key lives in Secret Manager (`IDENTITY_VAULT_ENCRYPTION_KEY`), never in
application config or a Firestore document, and is only ever bound into a
Cloud Function that explicitly declares it. This is deliberately **split-key,
not policy-free**: possessing the key decrypts nothing on its own -
`decryptIdentity()` additionally requires an already-resolved authorization
grant, a documented reason of at least 10 characters, and a case ID, and logs
every attempt (granted, denied, or failed) to `identityAccessAuditLog`. See
[`access-control.md`](access-control.md) for who can be authorized.

**Object storage.** Evidence files (`case-evidence/**`) and policy documents
(`company-policies/**`) have no direct client read or write path at all -
`storage.rules` denies both. The only way bytes move is a V4 signed URL,
minted server-side after the caller proves they hold the case (Case ID +
passcode for a reporter, Firebase Auth + assignment for staff), good for at
most 15 minutes, and never persisted.

**Key rotation.** `functions/src/security/keyRotation.js` tracks the age of
`IDENTITY_VAULT_ENCRYPTION_KEY`, the VAPID web-push key pair, and the
Anthropic API key against a configured threshold (default 365 days,
`KEY_ROTATION_ALERT_DAYS`), alerting a Super Admin once a key is overdue.
This app has no Secret Manager admin access, so age is tracked from the last
time an operator recorded a rotation (`recordKeyRotation`), not from Secret
Manager's own metadata.

**Re-encryption path.** Rotating `IDENTITY_VAULT_ENCRYPTION_KEY` requires
re-encrypting every stored envelope. `rotateEnvelopeKey()` in
`identityVault.js` decrypts with the outgoing key and encrypts with the
incoming key **inside one function call that never returns plaintext to its
caller** - the migration in `keyRotation.js`
(`rotateIdentityVaultKey`) only ever sees ciphertext. It processes cases in
bounded, resumable pages (never the whole vault in one pass) and logs one
`keyRotationLog` entry per record re-encrypted - never a bulk plaintext
dump, and never a single log entry covering more than one record.

## Evidence

- `keyRotationState/{keyId}` - current age, threshold, and last-rotated time
  per tracked key.
- `keyRotationLog` - append-only: every age check, every operator-recorded
  rotation, and every per-record vault re-encryption event.
- The "Key ages" panel on `SecurityDashboard.jsx`.
