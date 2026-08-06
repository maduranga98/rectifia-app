# Change management

## Control

Code changes are reviewed before merge, deployed through a single automated
pipeline rather than by hand, and checked for known-vulnerable dependencies
on every change - with a build-breaking gate, not an advisory one, on
high/critical findings.

## Implementation

**Source control and review.** All application code lives in this Git
repository. Changes land on `main` through pull requests; branch protection
and required reviewers are configured at the GitHub repository/organization
level (outside this codebase, and outside what any file here can enforce -
an auditor asking for this evidence should be pointed at the repository's
branch protection settings, not at a file).

**Automated deployment.** `.github/workflows/firebase-hosting-merge.yml`
builds and deploys to Firebase Hosting on every merge to `main`;
`.github/workflows/firebase-hosting-pull-request.yml` builds a preview
channel for every pull request before merge. Firestore rules
(`firestore.rules`), indexes (`firestore.indexes.json`), and Cloud Functions
(`functions/`) are deployed via the Firebase CLI against the same repository
state - there is no path for a rule, index, or function to reach production
without having first been committed and reviewed.

**Dependency vulnerability scanning.** CI runs `npm audit` against both the
root app and `functions/`, on every push and pull request, and **fails the
build** on any high or critical finding - see the `audit` job in
`.github/workflows/dependency-audit.yml`, with the actual pass/fail decision
made by `scripts/checkAuditSeverity.cjs`. This is deliberately a gate, not a
report: a dependency with a known high/critical vulnerability cannot merge
silently. Every run's result - packages scanned, findings by severity,
pass/fail - is recorded to the `dependencyScans` collection via
`functions/scripts/recordDependencyScan.js`, so "when did we last scan, and
what did we find" has a durable answer beyond CI's own log retention.

**Documented exceptions, not silent ones.** An advisory can legitimately not
apply to how this codebase uses the affected package - a vulnerable code
path (an unused transport option, a framework mode this app never enables)
that simply isn't reached. `checkAuditSeverity.cjs` supports exactly one way
to handle that: a narrow, per-advisory-ID allowlist entry with a written
reason, reviewed individually, never a severity-wide bypass. As of this
writing one entry exists - GHSA-qwww-vcr4-c8h2, a CSRF bypass in React
Router's RSC framework mode, which this app never enables (it uses
`react-router-dom` in classic `<BrowserRouter>` SPA mode only) - and it is
removed the moment a fixed version ships and the dependency is upgraded to
it. An allowlist entry is itself part of this control's evidence: an auditor
reading the file sees exactly what was excluded, why, and when it was
reviewed.

**Change management applied to data, not just code.** Two examples already
in this codebase, worth citing to an auditor as change management extending
past source control: the pulse-check questionnaire is versioned and
immutable-forward (`functions/src/pulse/questionSet.js` - a published
version can never be rewritten, only superseded), and every case's retention
policy change is itself logged with actor and timestamp
(`firestore.rules`' `isValidRetentionUpdate`).

## Evidence

- Pull request history and required reviews - GitHub, not this repository's
  files.
- GitHub Actions run history for both workflow files above.
- `dependencyScans` - one document per CI run, admin-readable evidence of
  every dependency scan and its outcome.
