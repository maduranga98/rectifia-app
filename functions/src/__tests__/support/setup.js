// Global test setup (see vitest.config.js's test.setupFiles).
//
// WHY THIS FILE PATCHES NODE'S MODULE RESOLVER DIRECTLY, RATHER THAN USING
// vi.mock OR vite's resolve.alias:
//
// Every production module under test is genuine CommonJS
// (`require(...)`/`module.exports`), because functions/ is its own CJS
// package (functions/package.json has no "type": "module", unlike the repo
// root). When such a file is loaded from an ESM test file, Vitest's SSR
// pipeline only rewrites `import`/`export` syntax - a plain `require(...)`
// call inside an already-CommonJS file is left untouched and is serviced by
// Node's own module loader, not Vite's. That was confirmed empirically while
// building this suite: both vi.mock('firebase-admin', ...) and a matching
// vite resolve.alias were silently ignored by a require('firebase-admin')
// issued from inside a project .js file (though the exact same specifier
// resolved to the mock correctly when imported directly by an ESM test
// file). Nested requires - which is exactly what functions/src/consistency/
// checkConsistency.js and friends do internally - never reached the mock
// either way.
//
// Patching node:module's own resolver is the seam one level below Vite that
// both paths above have to funnel through regardless of module format, so it
// is the one place a substitution reliably takes effect for every require()
// call in the process, first-party or not. This is the same technique tools
// like `proxyquire`/`mock-require` use internally; it is applied only to the
// exact package names this suite mocks, and only for the lifetime of the
// test process.
import Module from 'node:module'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))

const REDIRECTS = {
  'firebase-admin': `${here}mockFirebaseAdminCjs.cjs`,
  'firebase-functions/v2/https': `${here}aliasHttpsCjs.cjs`,
  'firebase-functions/v2/firestore': `${here}aliasFirestoreTriggersCjs.cjs`,
  'firebase-functions/v2/scheduler': `${here}aliasSchedulerCjs.cjs`,
  'firebase-functions/params': `${here}aliasParamsCjs.cjs`,
  'firebase-functions': `${here}aliasLoggerCjs.cjs`,
}

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolveFilename(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(REDIRECTS, request)) {
    return REDIRECTS[request]
  }
  return originalResolveFilename.call(this, request, ...rest)
}
