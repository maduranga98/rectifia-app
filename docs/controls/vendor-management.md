# Vendor management

## Control

Every sub-processor this platform relies on is identified, scoped to what it
actually receives, and - where it is a code dependency rather than an
infrastructure provider - continuously scanned for known vulnerabilities.

## Sub-processors

**Google Cloud Platform / Firebase.** Firestore (database), Cloud Storage
(evidence and policy document bytes), Firebase Authentication (staff
accounts), Cloud Functions (all server-side logic), and Secret Manager
(encryption keys and credentials) - the entire backend runs on this one
infrastructure vendor. Firestore's configured location is `nam5` (a US
multi-region), set in [`firebase.json`](../../firebase.json).

**Anthropic (Claude API).** Used for case-severity scoring, follow-up
question generation, checklist generation, and pulse-check response
analysis. Every call is made **server-side only**, from a Cloud Function that
declares the `ANTHROPIC_API_KEY` secret explicitly (see
`functions/src/intake/aiFollowUp.js` and siblings) - the key never reaches a
client, and there is no client-side call path to the Anthropic API anywhere
in this codebase. What is sent is the minimum needed for the task at hand
(e.g., questionnaire answers for the case being scored), never a reporter's
decrypted identity - the identity vault's authorization model
([`encryption.md`](encryption.md)) has no branch that hands plaintext
identity to a prompt.

**SMTP provider.** Transactional email (staff invitations, deadline
escalations, pulse-check invites, deletion-request and access-review
notices) is sent via SMTP, configured through `functions/src/utils/email.js`
(`SMTP_HOST`/`SMTP_USER`/`SMTP_FROM` as deploy-time config, `SMTP_PASSWORD`
as a Secret Manager secret). The default host is a placeholder; whichever
domain actually sends mail must have SPF, DKIM, and DMARC published, or
delivery either fails or is unauthenticated - see the warning comment in
`email.js`.

**Web push.** Browser push notifications use the standard Web Push protocol
(VAPID keys, `functions/src/notifications/sendCaseUpdate.js`) delivered
through each browser vendor's own push service (e.g., FCM for Chrome) - no
separate third-party push vendor is contracted directly.

## Dependency (code-level vendor) risk

Every third-party npm package this app or its Cloud Functions depend on is a
code-level vendor relationship. `npm audit` runs in CI on every push and pull
request against both `package.json` (root) and `functions/package.json`,
**failing the build on any high or critical finding** - see
[`change-management.md`](change-management.md) for the CI implementation.
Results are recorded to `dependencyScans` so a scan history exists
independent of CI log retention.

## Evidence

- This document, listing every sub-processor and what it receives.
- `dependencyScans` - one record per CI dependency scan.
- Secret Manager's own access-control list for who can read the secrets
  above (`IDENTITY_VAULT_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`,
  `SMTP_PASSWORD`, VAPID keys) - a GCP IAM artifact, not a file in this
  repository.
