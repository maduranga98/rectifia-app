// Run by CI (see .github/workflows/dependency-audit.yml), never manually
// against production data in the normal course of development - this is the
// evidence-recording half of the change-management/vendor-management gate
// documented in docs/controls/change-management.md and
// docs/controls/vendor-management.md. The gate itself (failing the build on
// a high/critical finding) is enforced entirely in the workflow's own exit
// code; this script only ever records what `npm audit` found, never decides
// whether the build should pass.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
//     node scripts/recordDependencyScan.js <package-label> <path-to-npm-audit-json>
//
// <path-to-npm-audit-json> is the raw output of `npm audit --json`, saved to
// a file by the workflow. This never reads npm's own registry or network -
// it only parses a JSON file already produced elsewhere, so a bad or
// unreachable Firestore write can never block the audit itself from having
// run.

const fs = require('fs')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const DEPENDENCY_SCANS_COLLECTION = 'dependencyScans'

function summarizeAuditReport(report) {
  // npm's `audit --json` shape has changed across major npm versions; both
  // the legacy `metadata.vulnerabilities` map and the newer per-advisory
  // `vulnerabilities` object are handled so this doesn't silently under-count
  // on whichever npm version CI happens to run.
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }

  if (report?.metadata?.vulnerabilities) {
    for (const severity of Object.keys(counts)) {
      counts[severity] = Number(report.metadata.vulnerabilities[severity] ?? 0)
    }
    return counts
  }

  if (report?.vulnerabilities) {
    for (const advisory of Object.values(report.vulnerabilities)) {
      const severity = advisory.severity
      if (severity && severity in counts) counts[severity] += 1
    }
  }
  return counts
}

async function main() {
  const [packageLabel, reportPath] = process.argv.slice(2)
  if (!packageLabel || !reportPath) {
    console.error('Usage: node scripts/recordDependencyScan.js <package-label> <path-to-npm-audit-json>')
    process.exit(1)
  }

  const raw = fs.readFileSync(reportPath, 'utf8')
  const report = raw.trim() ? JSON.parse(raw) : {}
  const counts = summarizeAuditReport(report)
  const highOrCritical = counts.high + counts.critical

  await admin
    .firestore()
    .collection(DEPENDENCY_SCANS_COLLECTION)
    .add({
      package: packageLabel,
      counts,
      highOrCriticalCount: highOrCritical,
      gatePassed: highOrCritical === 0,
      scannedAt: admin.firestore.FieldValue.serverTimestamp(),
      // CI metadata only - never a dependency name or advisory text, which
      // would make this collection a mirror of registry data rather than a
      // scan-history record.
      commitSha: process.env.GITHUB_SHA ?? null,
      workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    })

  console.log(`Recorded ${packageLabel} scan: ${JSON.stringify(counts)}`)
}

main().catch((err) => {
  console.error('recordDependencyScan: failed to record scan (this does not affect the audit gate itself)', err)
  // Exits 0 deliberately: a Firestore write failure (e.g. no credentials
  // configured yet) must never be what fails a build - only an actual
  // high/critical finding does that, evaluated separately in the workflow.
  process.exit(0)
})
