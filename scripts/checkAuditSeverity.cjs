// The npm-audit gate itself, run by .github/workflows/dependency-audit.yml
// AFTER scan evidence has already been recorded to dependencyScans - kept as
// its own file rather than an inline workflow script so its logic is
// readable and diffable like any other change to this repository, and to
// avoid the escaping hazards of embedding a JS template literal inside a
// shell double-quoted `node -e` string.
//
// `npm audit --json` exits non-zero the moment ANY vulnerability (including
// low/moderate) exists, which is not this gate's threshold - see
// docs/controls/change-management.md. This script is what actually decides
// pass/fail: exit 1 the moment either scanned package tree has a high or
// critical finding, exit 0 otherwise.

const fs = require('fs')

function countHighAndCritical(report) {
  const meta = report?.metadata?.vulnerabilities
  if (meta) {
    return { high: Number(meta.high ?? 0), critical: Number(meta.critical ?? 0) }
  }
  let high = 0
  let critical = 0
  if (report?.vulnerabilities) {
    for (const advisory of Object.values(report.vulnerabilities)) {
      if (advisory.severity === 'high') high += 1
      if (advisory.severity === 'critical') critical += 1
    }
  }
  return { high, critical }
}

function main() {
  const targets = [
    ['root', 'root-audit.json'],
    ['functions', 'functions-audit.json'],
  ]

  let failed = false
  for (const [label, path] of targets) {
    const raw = fs.readFileSync(path, 'utf8').trim()
    const report = raw ? JSON.parse(raw) : {}
    const { high, critical } = countHighAndCritical(report)

    if (high + critical > 0) {
      console.error(`${label}: ${high} high, ${critical} critical vulnerabilities found`)
      failed = true
    } else {
      console.log(`${label}: no high/critical vulnerabilities`)
    }
  }

  if (failed) process.exit(1)
}

main()
