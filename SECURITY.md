# Security

Rectifia handles workplace investigation reports: sometimes anonymous,
sometimes identity-revealing, always sensitive. This document describes the
platform's technical security posture and how to report a vulnerability. It
is written for two audiences at once - an engineer changing this codebase,
and an auditor testing it against SOC 2 or ISO 27001 controls - because the
two should be reading the same facts.

## Reporting a vulnerability

If you believe you've found a security vulnerability in Rectifia, email
**security@rectifia.com** with a description and reproduction steps. Please
do not open a public GitHub issue for a suspected vulnerability, and please
do not access, modify, or exfiltrate case data belonging to a real company or
reporter while investigating - test against your own account and data only.
We aim to acknowledge reports within two business days.

## What "readiness" means here

Module 26 (Security Control & Evidence Layer) does not obtain a SOC 2 report
or an ISO 27001 certificate - those require an accredited auditor, a defined
audit period, and organizational controls (background checks, vendor
contracts, an incident response *team*, not just a runbook) that live outside
this codebase entirely. What this module does is close the *technical*
control gaps an auditor tests during that process, and make the system
produce its own evidence continuously, so the weeks before an audit window
are spent reviewing evidence rather than assembling it for the first time.

Concretely, that means:

- **Every control that matters runs on a schedule, not on request.**
  Access reviews, key-rotation checks, anomaly detection, data-integrity
  checks, and backup verification all run automatically (see the cadence
  table below) and write their own record of having run - see
  "Evidence, and the absence of it" below.
- **Every control is advisory.** Nothing in this module revokes access,
  deletes data, or blocks a user automatically. A false positive that locks
  an investigator out mid-investigation is worse than the alert it would
  have replaced; every finding becomes something a human reads and acts on.
- **Nothing here widens who can read case content.** Every control is built
  entirely out of *metadata* - actor, timestamp, action type, counts - never
  case content, a narrative, an identity, or evidence bytes. There is no
  "Super Admin can view any case for security purposes" path, and building
  one would itself be a finding, not a control.

## Control areas

Each area below has its own document in [`docs/controls/`](docs/controls/)
stating the control, how it is implemented, and exactly where its evidence
lives (which Firestore collection, which scheduled function, which screen).

| Area | Document |
| --- | --- |
| Access control | [`docs/controls/access-control.md`](docs/controls/access-control.md) |
| Encryption | [`docs/controls/encryption.md`](docs/controls/encryption.md) |
| Logging & monitoring | [`docs/controls/logging-monitoring.md`](docs/controls/logging-monitoring.md) |
| Change management | [`docs/controls/change-management.md`](docs/controls/change-management.md) |
| Incident response | [`docs/controls/incident-response.md`](docs/controls/incident-response.md) |
| Vendor management | [`docs/controls/vendor-management.md`](docs/controls/vendor-management.md) |
| Business continuity & disaster recovery | [`docs/controls/bcdr.md`](docs/controls/bcdr.md) |

## Evidence, and the absence of it

Every scheduled control in `functions/src/security/` writes a run record to
the `securityControlRuns` collection **every time it runs, whether or not it
finds anything**. "The control ran and found no exceptions" is the evidence;
a missing record is indistinguishable from a broken job, which is exactly the
gap this module closes. `src/pages/superadmin/SecurityDashboard.jsx` is the
one screen that shows this evidence: open alerts, pending access-review
attestations, key ages, last verified backup, and when every control last
ran - readable by a Super Admin only, backed by a single callable
(`getSecurityDashboard`) because every collection behind it is sealed to
direct client reads (see [`firestore.rules`](firestore.rules)).

Audit and control records are **append-only and Admin-SDK-write-only**. No
client role - including Super Admin - has a Firestore rules path to write or
edit `privilegedActionLog`, `identityAccessAuditLog`, `triageAccessLog`,
`staffIntakeAuditLog`, `evidenceAccessLog`, `securityAlerts`, `accessReviews`,
`keyRotationLog`, `integrityFindings`, or `securityControlRuns`. A record a
human could edit after the fact is not a record.

## Scheduled controls at a glance

| Control | Cadence | Function | Evidence collection(s) |
| --- | --- | --- | --- |
| Access review | Quarterly | `accessReview` | `accessReviews` |
| Key rotation check | Weekly | `keyRotationCheck` | `keyRotationLog`, `keyRotationState` |
| Anomaly detection | Daily | `anomalyDetection` | `securityAlerts`, `anomalyBaselines` |
| Data integrity check | Weekly | `integrityCheck` | `integrityFindings` |
| Backup verification | Monthly | `backupVerification` | `backupVerifications` |
| Dependency vulnerability scan | Every CI run | GitHub Actions `npm audit` step | `dependencyScans` |

Every row also writes to the shared `securityControlRuns` collection - see
`functions/src/security/controlRunLog.js`.

## Existing strengths this module preserves, not rebuilds

Module 26 is additive. It does not replace or weaken any of the following,
which shipped in earlier modules and remain the foundation everything above
is built on:

- Per-case audit logs: `identityAccessAuditLog`, `triageAccessLog`,
  `staffIntakeAuditLog`, `evidenceAccessLog`.
- The split-key identity vault (`functions/src/utils/identityVault.js`):
  AES-256-GCM, key in Secret Manager, decryption gated on a documented reason
  and an audited authorization decision made by the call site, never the
  vault itself.
- Signed-URL-only object storage for evidence (`case-evidence/**`) and policy
  documents (`company-policies/**`) - no direct client read or write path to
  either bucket prefix.
- Server-side-only calls to the Anthropic API - the API key never reaches a
  client, and every call runs inside an already-authorized Cloud Function.
- Role separation with mirror collections (`caseMetadata`, `pulseSummaries`,
  `companies/{companyId}/stats`) so a role's Firestore rules path is built
  from a narrower, purpose-built document rather than a filtered read of the
  real one.
