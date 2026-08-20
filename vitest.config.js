import { defineConfig } from 'vitest/config'

// Minimal test harness for Rectifia. Pure unit tests over exported helper
// functions in functions/src - no Firebase emulator, no network, no
// Anthropic API calls (see functions/src/__tests__/support for how
// admin.firestore() and the firebase-functions v2 wrappers are mocked
// instead of stood up for real) - plus pure-function unit tests under
// src/**/__tests__. Both sets stay on `environment: 'node'`: this config does
// not run React component tests, and adding jsdom for one src/ suite would
// slow every test here down for no benefit to it.
//
// resolve.alias covers ESM `import` of these packages (from test files);
// support/setup.js additionally patches node:module's CJS resolver so a
// production module's plain `require('firebase-admin')` resolves to the
// exact same file - see that file's header comment for why both are needed.
const testSupportDir = new URL('./functions/src/__tests__/support/', import.meta.url).pathname

export default defineConfig({
  resolve: {
    alias: [
      { find: /^firebase-admin$/, replacement: `${testSupportDir}mockFirebaseAdminCjs.cjs` },
      { find: /^firebase-functions\/v2\/https$/, replacement: `${testSupportDir}aliasHttpsCjs.cjs` },
      { find: /^firebase-functions\/v2\/firestore$/, replacement: `${testSupportDir}aliasFirestoreTriggersCjs.cjs` },
      { find: /^firebase-functions\/v2\/scheduler$/, replacement: `${testSupportDir}aliasSchedulerCjs.cjs` },
      { find: /^firebase-functions\/params$/, replacement: `${testSupportDir}aliasParamsCjs.cjs` },
      { find: /^firebase-functions$/, replacement: `${testSupportDir}aliasLoggerCjs.cjs` },
      { find: /^@anthropic-ai\/sdk$/, replacement: `${testSupportDir}aliasAnthropicCjs.cjs` },
    ],
  },
  test: {
    environment: 'node',
    include: ['functions/src/**/__tests__/**/*.test.js', 'src/**/__tests__/**/*.test.js'],
    setupFiles: ['./functions/src/__tests__/support/setup.js'],
    globals: false,
    testTimeout: 5000,
    hookTimeout: 5000,
  },
})
