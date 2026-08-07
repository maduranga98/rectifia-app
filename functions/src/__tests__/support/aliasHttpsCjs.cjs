// Stands in for 'firebase-functions/v2/https'. onCall strips Cloud Functions'
// own deploy-time wrapper and returns the handler itself, so
// `exports.someCallable(request)` in a test is a direct call into the real
// business logic - see support/setup.js for why this redirect is wired up
// through node:module rather than vi.mock.
function unwrap(optionsOrHandler, maybeHandler) {
  return typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler
}

class HttpsError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'HttpsError'
    this.code = code
  }
}

module.exports = {
  onCall: (optionsOrHandler, maybeHandler) => unwrap(optionsOrHandler, maybeHandler),
  HttpsError,
}
