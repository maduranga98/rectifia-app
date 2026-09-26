import { defineConfig } from 'vitest/config'

// Firestore security-rules tests. They need the Firestore emulator, so they
// are kept out of the default `npm test` run; use `npm run test:rules`, which
// starts the emulator around them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.js'],
    testTimeout: 15000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
