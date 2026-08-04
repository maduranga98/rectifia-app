const { defineSecret, defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const nodemailer = require('nodemailer')

// SMTP delivery for transactional email (currently just staff invitations).
// The password is the only genuinely sensitive value, so it lives in Secret
// Manager (defineSecret) and is entered after deploy - the host/port/user are
// deploy-time config with sensible defaults for the offboardset.com mailbox.
//
// Any function that calls sendMail MUST declare smtpPassword in its `secrets`
// array (same pattern sendCaseUpdate.js uses for its VAPID secrets) or the
// value will be undefined at runtime.
const smtpPassword = defineSecret('SMTP_PASSWORD')
const smtpHost = defineString('SMTP_HOST', { default: 'mail.spacemail.com' })
const smtpPort = defineString('SMTP_PORT', { default: '465' })
const smtpUser = defineString('SMTP_USER', { default: 'hello@offboardset.com' })
const smtpFrom = defineString('SMTP_FROM', { default: 'Offboardset <hello@offboardset.com>' })

let cachedTransporter = null

// Builds (once per instance) a nodemailer transport. Port 465 uses implicit
// TLS (secure: true); 587 uses STARTTLS (secure: false). We follow the
// provider's guidance: 465 with SSL is the primary config.
function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter
  }
  const port = Number(smtpPort.value())
  cachedTransporter = nodemailer.createTransport({
    host: smtpHost.value(),
    port,
    secure: port === 465,
    auth: {
      user: smtpUser.value(),
      pass: smtpPassword.value(),
    },
  })
  return cachedTransporter
}

// Sends one email. Throws on failure so the caller can decide whether a
// delivery failure should fail the whole operation or just be logged.
async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter()
  const info = await transporter.sendMail({
    from: smtpFrom.value(),
    to,
    subject,
    text,
    html,
  })
  logger.info('email sent', { to, subject, messageId: info.messageId })
  return info
}

module.exports = { sendMail, smtpPassword }
