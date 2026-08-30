// Stand-in for `nodemailer` (functions/src/utils/email.js's only third-party
// dependency). Nothing in this suite exercises SMTP delivery - the modules
// under test only need `require('nodemailer')` to resolve so their pure
// helpers can be imported without the real package (or a real socket) being
// present. createTransport returns a transport whose sendMail resolves with a
// fake messageId; a test that wants to assert on delivery should stub
// sendMail itself rather than lean on this.
function createTransport() {
  return {
    async sendMail() {
      return { messageId: 'test-message-id' }
    },
  }
}

module.exports = { createTransport }
