// Stand-in for `nodemailer` (functions/src/utils/email.js's only third-party
// dependency). No socket is opened; createTransport returns a transport whose
// sendMail resolves with the same envelope result shape the real library
// gives back.
//
// That shape matters and is not decoration. The real sendMail resolves as long
// as the server accepted at least ONE recipient, reporting the refused ones in
// `rejected` without throwing - which is how an invitation could be recorded
// as 'sent' while the address had already been declined. email.js now inspects
// `accepted`/`rejected`/`pending`, so a mock that omitted them would make
// every caller's success path look like a total rejection. The default below
// is therefore a full acceptance; __setNextResult() overrides it for the one
// test that needs a refusal.
let nextResult = null

function defaultResult(options) {
  const recipients = []
    .concat(options?.to ?? [])
    .flatMap((value) => String(value).split(',').map((part) => part.trim()))
    .filter(Boolean)
  return {
    messageId: 'test-message-id',
    accepted: recipients,
    rejected: [],
    pending: [],
    response: '250 2.0.0 Ok: queued as TEST',
  }
}

function createTransport() {
  return {
    async sendMail(options) {
      if (nextResult) {
        const result = { ...defaultResult(options), ...nextResult }
        nextResult = null
        return result
      }
      return defaultResult(options)
    },
  }
}

// Test hook: queues the envelope result the NEXT sendMail call resolves with.
// Consumed once, so it cannot leak into an unrelated test.
function __setNextResult(result) {
  nextResult = result
}

function __reset() {
  nextResult = null
}

module.exports = { createTransport, __setNextResult, __reset }
