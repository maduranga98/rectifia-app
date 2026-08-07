// Stands in for 'firebase-functions/v2/firestore'. Each wrapper strips Cloud
// Functions' own trigger-binding layer and returns the raw handler, so
// `exports.someTrigger(event)` in a test calls the real business logic
// directly with a plain test-authored event object - see support/setup.js
// for why this redirect is wired up through node:module rather than vi.mock.
module.exports = {
  onDocumentWritten: (optionsOrDoc, handler) => handler,
  onDocumentUpdated: (optionsOrDoc, handler) => handler,
  onDocumentCreated: (optionsOrDoc, handler) => handler,
}
