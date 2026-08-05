# Access control

## Control

Access to case content and platform administration is granted by role, scoped
to a single company, granted through one server-side path, and reviewed on a
recurring schedule with a documented keep/revoke decision per account
(CC6.2, CC6.3).

## Implementation

**Role model.** Five company-scoped roles (`companyAdmin`, `hrCoordinator`,
`caseHandler`, `manager`, `pulseCheckReviewer` - see
[`src/constants/roles.js`](../../src/constants/roles.js)) plus one
platform-scoped role, Super Admin, which is allowlist membership in the
`superAdmins` collection rather than a role at all. Roles are Firebase Auth
**custom claims**, set exactly once, only by
[`functions/src/staff/inviteStaff.js`](../../functions/src/staff/inviteStaff.js)
running with the Admin SDK. `firestore.rules` reads `request.auth.token`
exclusively for every role check - never a client-writable Firestore field -
so a compromised staff document cannot be used to escalate privilege.

**Least privilege by design, not by filter.** Company Admin's Firestore rules
path never reaches case content: its one case-derived read is the aggregate
`companies/{companyId}/stats` rollup. This is enforced structurally - Company
Admin has no rules path to `cases/`, `caseMetadata/`, or a messages
subcollection at all - not by a client-side filter that a modified frontend
could bypass. The same holds for Super Admin: there is no "view any case"
path anywhere in this codebase, in this module or any other.

**Provisioning and de-provisioning.** Accounts are created only through
`inviteStaff` (Company Admin action, Admin SDK) and deactivated by a Company
Admin editing the staff document directly. Every privileged action a staff
account takes - not only case reads, but legal holds, policy management,
benchmark opt-in, pulse-check administration, case reassignment, and more -
is now logged with actor, role, action type, and outcome via
[`logPrivilegedAction`](../../functions/src/utils/staffAuth.js), the
chokepoint every staff-facing callable resolves identity through.

**Periodic review.** `functions/src/security/accessReview.js` runs quarterly.
For every company it compiles every staff account, its role, its last Auth
sign-in, its last privileged action, and flags accounts with no sign-in
activity in 90+ days. A Company Admin attests the review with a recorded
keep/revoke decision per account (`attestAccessReview`); the review document
and its attestation are both immutable once written - CC6.2/CC6.3 are tested
by asking for exactly this artifact.

**Anomaly detection on access patterns.** `functions/src/security/
anomalyDetection.js` runs daily and flags identity decryptions above a
per-actor learned baseline, bulk evidence downloads, report-export volume
above baseline, access outside a company's configured working hours, and a
staff account touching cases across an unusual number of departments.
Detection only - see [`incident-response.md`](incident-response.md) for what
happens to a flagged finding.

## Evidence

- `accessReviews/{companyId}_{period}` - one document per company per
  quarter, with the full account roster and, once completed, the attestation
  (reviewer, timestamp, per-account decision).
- `privilegedActionLog` - every privileged action attempt, granted or
  denied, platform-wide. Admin-SDK read/write only, including for Super
  Admin - see [`logging-monitoring.md`](logging-monitoring.md).
- `securityAlerts` - anomaly findings, reviewable via `reviewSecurityAlert`.
- `src/pages/superadmin/SecurityDashboard.jsx` - the single screen showing
  open alerts, pending reviews, and (for the other control areas) key ages
  and backup status, for a Super Admin.
