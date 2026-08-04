const { defineSecret, defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const nodemailer = require('nodemailer')

// SMTP delivery for transactional email (staff invitations, deadline
// escalations, pulse-check invites). The password is the only genuinely
// sensitive value, so it lives in Secret Manager (defineSecret) and is entered
// after deploy - the host/port/user are deploy-time config.
//
// Any function that calls sendMail MUST declare smtpPassword in its `secrets`
// array (same pattern sendCaseUpdate.js uses for its VAPID secrets) or the
// value will be undefined at runtime.
//
// BEFORE LAUNCH: SPF, DKIM and DMARC must be published in DNS for
// rectifia.com, the domain in SMTP_FROM below. Without them this mail is
// unauthenticated and lands in spam or is rejected outright - and the mail
// this system sends is not marketing: it is a staff invitation someone needs
// to accept to get an account, and a compliance-deadline escalation with a
// legal clock attached. Both failing silently is a launch blocker, not a
// deliverability nicety. If the sending domain is not rectifia.com, override
// SMTP_USER/SMTP_FROM at deploy time and authenticate *that* domain instead;
// the From domain and the authenticated domain have to be the same one.
//
// These defaults previously pointed at hello@offboardset.com - a different
// product on a different domain, which meant Rectifia's mail was being sent
// under someone else's identity and could never have passed DMARC alignment.
const smtpPassword = defineSecret('SMTP_PASSWORD')
const smtpHost = defineString('SMTP_HOST', { default: 'mail.spacemail.com' })
const smtpPort = defineString('SMTP_PORT', { default: '465' })
const smtpUser = defineString('SMTP_USER', { default: 'hello@rectifia.com' })
const smtpFrom = defineString('SMTP_FROM', { default: 'Rectifia <hello@rectifia.com>' })

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
