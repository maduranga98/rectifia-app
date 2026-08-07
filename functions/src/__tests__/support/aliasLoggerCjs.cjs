// Stands in for the bare 'firebase-functions' specifier (used only for its
// `logger`) - see aliasHttpsCjs.cjs for the pattern and support/setup.js for
// why it's wired up this way.
module.exports = {
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}
