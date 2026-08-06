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
// critical finding that is NOT on the allowlist below, exit 0 otherwise.

const fs = require('fs')

// Advisories judged, individually and in writing, not to apply to how this
// app actually uses the affected package - never a blanket severity
// downgrade, and never a way to silence a finding without a paper trail. The
// gate stays strict for everything else; this is the documented exception
// path change-management.md itself describes, not a bypass of it.
//
// Add an entry only after confirming the vulnerable code path is genuinely
// unreached (read the advisory, grep the codebase, don't assume). Remove an
// entry the moment a fixed version ships and the dependency is upgraded to
// it - an allowlist entry that outlives its own justification is worse than
// no allowlist at all.
const ALLOWLISTED_ADVISORIES = {
  'GHSA-qwww-vcr4-c8h2': {
    package: 'react-router / react-router-dom',
    reason:
      'CSRF bypass in React Router RSC (React Server Components) framework-mode server actions. This app uses react-router-dom exclusively in classic SPA mode - <BrowserRouter> wrapping <Routes>/<Route> (src/main.jsx, src/App.jsx) - with no createBrowserRouter/RouterProvider, no RSC, and no server actions anywhere in the codebase, so the vulnerable request path is never reached. No non-vulnerable 7.x release exists yet (7.18.2 is latest; the fixed range starts at 8.3.0, not yet published). Revisit and remove this entry once a fixed version ships and the dependency is upgraded to it.',
    reviewedAt: '2026-08-06',
  },
}

// Walks the detailed per-package vulnerability map (not the aggregate
// metadata.vulnerabilities counts, which have no advisory IDs to check
// against the allowlist) and returns every high/critical advisory found,
// each tagged with its GHSA id so it can be checked individually. A `via`
// entry is either the real advisory object (has a `.url` ending in the
// GHSA id) or a bare package-name string (a chain: this package is only
// vulnerable because something it depends on is) - only the former carries
// an id worth collecting, which is also correct for allowlisting: the
// chained package (e.g. react-router-dom) never appears here on its own,
// only the root cause (react-router) does, and excluding the root cause is
// what should exclude the whole chain.
function collectHighAndCriticalAdvisories(report) {
  const found = []
  const vulnerabilities = report?.vulnerabilities
  if (!vulnerabilities) return found

  for (const entry of Object.values(vulnerabilities)) {
    if (entry.severity !== 'high' && entry.severity !== 'critical') continue
    for (const via of entry.via || []) {
      if (typeof via !== 'object' || !via.url) continue
      const id = via.url.split('/').pop()
      found.push({ id, package: entry.name, severity: entry.severity, title: via.title })
    }
  }
  return found
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
    const advisories = collectHighAndCriticalAdvisories(report)

    const blocking = advisories.filter((a) => !ALLOWLISTED_ADVISORIES[a.id])
    const allowlisted = advisories.filter((a) => ALLOWLISTED_ADVISORIES[a.id])

    for (const a of allowlisted) {
      console.log(`${label}: ${a.id} (${a.package}, ${a.severity}) allowlisted - ${ALLOWLISTED_ADVISORIES[a.id].reason}`)
    }

    if (blocking.length > 0) {
      for (const a of blocking) {
        console.error(`${label}: ${a.id} (${a.package}, ${a.severity}) - ${a.title}`)
      }
      failed = true
    } else {
      console.log(`${label}: no blocking high/critical vulnerabilities`)
    }
  }

  if (failed) process.exit(1)
}

main()
