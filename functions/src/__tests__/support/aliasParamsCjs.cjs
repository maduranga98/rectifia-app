// Stands in for 'firebase-functions/params' - see aliasHttpsCjs.cjs for the
// pattern and support/setup.js for why it's wired up this way.
module.exports = {
  // A fixed, valid 32-byte hex key so functions/src/utils/identityVault.js's
  // REAL AES-256-GCM encrypt/decrypt code runs unmodified in tests - the only
  // thing mocked is where the key comes from (Secret Manager), never the
  // cryptography itself.
  defineSecret: (name) => ({
    name,
    value: () => 'a'.repeat(64),
  }),
  defineInt: (name, options) => ({ value: () => options?.default ?? 0 }),
  defineString: (name, options) => ({ value: () => options?.default ?? '' }),
  defineBoolean: (name, options) => ({ value: () => options?.default ?? false }),
}
