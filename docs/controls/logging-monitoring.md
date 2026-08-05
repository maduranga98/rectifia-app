# Logging & monitoring

## Control

Every access to case content is logged, every privileged action is logged,
audit logs are append-only and unreadable (not just unwritable) by every
client role including Super Admin, and access patterns are monitored daily
for deviation from normal - without any of it becoming a second copy of case
data.

## Implementation

**Per-case audit logs (pre-existing, module 26 preserves them unchanged).**
Four collections, one per audited surface, all Admin-SDK write-only and
sealed to `allow read, write: if false` for every client role:

- `identityAccessAuditLog` - every identity/contact-email decryption attempt
  (`functions/src/utils/identityVault.js`).
- `triageAccessLog` - every read of an unassigned case during triage
  (`functions/src/investigation/getCaseForTriage.js`).
- `staffIntakeAuditLog` - every case filed on a reporter's behalf by staff
  (`functions/src/intake/createCaseOnBehalf.js`).
- `evidenceAccessLog` - every signed URL issued for evidence, upload or
  download (`functions/src/utils/evidenceStorage.js`).

**The chokepoint-level log (module 26).** The four logs above cover specific
sensitive reads; everything else a privileged callable does - proposing an
action, closing a case, reassigning it, placing a legal hold, managing a
policy document, publishing a questionnaire, sending a pulse check on
demand - previously left no actor-level trace. `functions/src/utils/
staffAuth.js`'s `loadCallerRole`/`loadCaseForHandler`/`loadCaseForTriage`/
`requireIntakeRole` are the one chokepoint nearly every staff-facing callable
resolves identity through, and now write a `privilegedActionLog` entry
(uid, company, role, action type, outcome, caseId if relevant) on every
resolution - grant or denial. Same fully-sealed posture as the four logs
above: no client role, including Super Admin, can read or write it directly.

**Anomaly detection.** `functions/src/security/anomalyDetection.js` runs
daily over the logs above and flags: identity decryptions above a per-actor
rolling baseline (exponential moving average), evidence downloads in bulk
(absolute threshold), report exports above a per-company baseline, access
outside a company's configured working hours, and a staff account touching
cases across an unusual number of departments. **Detection only** - see
[`incident-response.md`](incident-response.md).

**Operational logging.** Cloud Functions' own `logger.error`/`logger.warn`
calls throughout this codebase are for operators debugging a failed run, not
an audit trail - they log identifiers and error messages, never case
content, and are not a substitute for the collections above.

**What never appears in any of the above.** Case content, narrative text,
questionnaire answers, reporter identity, and evidence bytes. Every writer in
this list is built from other metadata - who, what type of action, when,
which case ID, which outcome - never from `cases/{caseId}`'s free-text
fields or a messages subcollection. A security log that quietly became a
second copy of case data would itself be a finding, not a control.

## Evidence

- `privilegedActionLog`, `identityAccessAuditLog`, `triageAccessLog`,
  `staffIntakeAuditLog`, `evidenceAccessLog` - sealed, queried only by
  server-side controls (`accessReview.js`, `anomalyDetection.js`).
- `securityAlerts` - anomaly findings, human-reviewable via
  `reviewSecurityAlert`.
- `anomalyBaselines` - the rolling per-actor/per-company baselines the daily
  check compares each day's count against (internal working state, not
  itself evidence an auditor reads directly - the alerts it produces are).
- The "Open alerts" panel on `SecurityDashboard.jsx`.
