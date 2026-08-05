# Incident response

## Control

Suspicious access patterns and integrity drift are detected automatically
and surfaced to a human continuously, rather than only being discoverable
after the fact; nothing in the detection path takes an automated containment
action, so a false positive never becomes an outage or a lockout on its own.

## Implementation

**What this codebase provides.** A technical detection and evidence-gathering
layer: `functions/src/security/anomalyDetection.js` (daily access-pattern
anomalies), `functions/src/security/integrityCheck.js` (weekly data-integrity
drift - see [`bcdr.md`](bcdr.md)), and `functions/src/security/
backupVerification.js` (monthly, flags a stale or unreadable backup) all
write findings to `securityAlerts` the moment they detect something. This is
the evidence-gathering and alerting half of incident response.

**What this codebase deliberately does not provide.** A written incident
response *plan* - who is on call, escalation paths, communication
templates, breach-notification timelines - is an organizational document,
not a code artifact, and lives outside this repository. Nothing in module 26
should be read as claiming that document exists; it documents what the
system does to help execute one.

**Detection is never automated response.** Every alert-producing check in
this module is explicitly detection-only: it has no code path that revokes
access, deactivates an account, deletes data, or blocks a user. The rationale
is stated directly in `anomalyDetection.js`: a false positive that locks an
investigator out mid-investigation is worse than the alert it would have
replaced. An alert becomes a `securityAlerts` row a human reads and decides
on - via `reviewSecurityAlert` once triaged - never an automated
consequence.

**Advisory notification.** Alerts that warrant proactive notice (a key
rotation overdue, an access review awaiting attestation) go through the
existing `notifications` queue and `deliverNotifications.js` - the same
delivery path already used for deadline escalations and staff invitations -
rather than a second, parallel alerting system.

**Forensic material already available to an investigation.** The audit logs
in [`logging-monitoring.md`](logging-monitoring.md) (who read what, when),
`deletionLog` (what was deleted or held, by whom, why), and legal hold
(`functions/src/retention/legalHold.js`, which freezes a case against every
retention sweep including identity purge) are all pre-existing tools an
incident investigation can draw on without this module adding anything new -
they are cited here because an incident-response *process* built around this
system should know they exist.

## Evidence

- `securityAlerts` - every detection finding, its severity, and its review
  status (open/reviewed, reviewer, note).
- `deletionLog`, `identityAccessAuditLog`, `triageAccessLog`,
  `staffIntakeAuditLog`, `evidenceAccessLog`, `privilegedActionLog` - the
  forensic record an investigation reads from.
- The "Open alerts" panel on `SecurityDashboard.jsx`.
