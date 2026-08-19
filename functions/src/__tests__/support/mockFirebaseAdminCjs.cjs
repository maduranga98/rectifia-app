// The seam this whole suite mocks instead of standing up an emulator: every
// production module under test calls `admin.firestore()` (and, in a couple
// of modules, `admin.firestore.FieldValue` / `admin.firestore.Timestamp`)
// directly rather than accepting a firestore instance as an argument.
//
// This is a genuine .cjs file, not transpiled ESM, because node:module's
// resolver (patched in support/setup.js) redirects both the CommonJS
// `require('firebase-admin')` production code issues AND the test files'
// own `import admin from 'firebase-admin'` to this exact same file path -
// see setup.js's header comment for why a single shared file, loaded through
// Node's real module cache, is what keeps "what a test seeds/reads" and
// "what production code writes" pointed at the same in-memory Firestore.
//
// `__reset()` and `__firestore()` are test-only extensions riding on the
// same object - production code never references them, it only ever sees
// the real firebase-admin surface (apps, initializeApp, firestore).
const { FakeFirestore } = require('./fakeFirestore.cjs')
const { FakeAuth } = require('./fakeAuth.cjs')

// This exact file is loaded twice - once through Node's real CJS module
// cache (production code's require('firebase-admin'), redirected by
// support/setup.js's node:module patch) and once through Vite's separate ESM
// module graph (a test file's `import admin from 'firebase-admin'`, redirected
// by vitest.config.js's resolve.alias). Those are two different loader
// registries, so two independent copies of this module's top-level scope get
// created even though both resolve to the identical file path - a
// module-scoped `const state = ...` would give each side its own Firestore
// and silently break every test that seeds through one side and reads
// through the other. Storing state on globalThis instead is what makes it
// one Firestore regardless of which loader got here first.
const GLOBAL_KEY = '__rectifia_test_firestore_state__'
if (!globalThis[GLOBAL_KEY]) {
  globalThis[GLOBAL_KEY] = { firestore: new FakeFirestore(), auth: new FakeAuth() }
}
const state = globalThis[GLOBAL_KEY]

function firestoreFn() {
  return state.firestore
}

function authFn() {
  return state.auth
}

firestoreFn.FieldValue = {
  serverTimestamp: () => ({ __fakeFieldValue: 'serverTimestamp' }),
  increment: (n) => ({ __fakeFieldValue: 'increment', n }),
  delete: () => ({ __fakeFieldValue: 'delete' }),
}

firestoreFn.Timestamp = {
  fromMillis: (ms) => ({ __fakeTimestamp: true, toMillis: () => ms }),
  now: () => ({ __fakeTimestamp: true, toMillis: () => Date.now() }),
}

module.exports = {
  apps: [],
  initializeApp: () => {},
  firestore: firestoreFn,
  auth: authFn,
  __reset: () => {
    state.firestore = new FakeFirestore()
    state.auth = new FakeAuth()
  },
  __firestore: () => state.firestore,
  __auth: () => state.auth,
}
