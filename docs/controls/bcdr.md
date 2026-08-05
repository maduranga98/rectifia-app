# Business continuity & disaster recovery (BCDR)

## Control

Data is backed up on a recurring schedule, the backup is confirmed to
actually exist and be readable every month, and a restore has been tested
and attested by an operator - not merely assumed to work because an export
job exists. Separately, an internal integrity sweep catches the specific
failure mode of a data-lifecycle job (retention deletion, mirror sync)
completing only partway.

## Implementation

**Firestore export.** Scheduled Firestore exports to a Cloud Storage bucket
are configured at the infrastructure level (Cloud Scheduler + `gcloud
firestore export`, or the Firestore console's managed Backups feature) -
this application has no code path that *triggers* an export, only one that
*verifies* the result, deliberately: an application-level job is the wrong
place to hold export credentials with write access to a backup bucket.

**Verification.** `functions/src/security/backupVerification.js` runs
monthly. It lists the configured backup bucket
(`FIRESTORE_EXPORT_BUCKET`) for the most recent export's metadata object and
**reads its bytes**, not just its listing - a listed-but-corrupted or
permission-broken export would pass a list-only check and fail this one. A
missing or stale export (older than `FIRESTORE_EXPORT_MAX_AGE_DAYS`, default
35) raises a `securityAlerts` finding.

**Restore testing.** A working export is not a verified backup until someone
has actually restored from it. This control cannot perform that restore
itself - doing so automatically would mean provisioning a second
Firestore-like environment and importing real case data into it on a
schedule, well outside what an unattended background job should be trusted
to do. Instead, `attestRestoreTest` records a Super Admin's attestation
(pass/fail, timestamp, notes) after they perform the drill manually, and the
monthly check raises a `restore_test_overdue` finding if no attestation
exists within `RESTORE_TEST_MAX_AGE_DAYS` (180 days).

**Statelessness of compute.** Cloud Functions and Firebase Hosting hold no
persistent state of their own - every function is redeployable from source
control with no local data to lose, so BCDR for the *application* reduces
entirely to BCDR for *Firestore and Cloud Storage*.

**Integrity, as the other half of continuity.** A backup restores what was
written; it does not catch what a running system wrote *incorrectly* -
specifically, a data-lifecycle sweep that fails halfway. `functions/src/
security/integrityCheck.js` runs weekly and verifies: no evidence object in
Storage lacks a Firestore pointer (and vice versa), no `pulseResponse` lacks
a genuinely spent invite, and no `caseMetadata` mirror has drifted from its
source case. This is explicitly the check that catches
[module 23's](../../functions/src/retention/applyRetention.js) retention
sweeps failing halfway - a case deleted from Firestore but not fully cleared
from Storage, or a mirror that stopped syncing, would surface here.

## Evidence

- `backupVerifications/{period}` - one document per month: export found,
  export readable, staleness, and the carried-forward restore-test
  attestation.
- `integrityFindings` - append-only, one entry per drift finding.
- The "Backup verification" and "Control runs" panels on
  `SecurityDashboard.jsx`.
