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
//
// Callers that swallow the throw (inviteStaff, resendStaffInvite,
// createCompanyAdmin, ...) only record err.message, which for an SMTP
// rejection is a generic "Invalid login" with no way to tell a wrong password
// from a sender the server won't accept. So the diagnostic detail nodemailer
// carries on the error is logged here, where it is still attached: `code`
// (EAUTH / ECONNECTION / EENVELOPE), `responseCode` (535 auth, 550 relay/
// sender rejected) and the server's own `response` line. The sending identity
// goes with it, because the usual cause is SMTP_USER/SMTP_FROM disagreeing
// with the account the SMTP_PASSWORD secret belongs to. No message body or
// password is logged.
async function sendMail({ to, subject, text, html }) {
  const transporter = getTransporter()
  const from = smtpFrom.value()
  let info
  try {
    info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    })
  } catch (err) {
    logger.error('email delivery failed', {
      to,
      subject,
      from,
      smtpUser: smtpUser.value(),
      smtpHost: smtpHost.value(),
      smtpPort: smtpPort.value(),
      code: err.code,
      responseCode: err.responseCode,
      response: err.response,
      error: err.message,
    })
    throw err
  }
  // A resolved sendMail() is NOT proof every recipient was accepted. SMTP
  // answers each RCPT TO separately, and nodemailer resolves as long as at
  // least ONE was accepted - the refused ones come back in `info.rejected`
  // with no exception raised. It throws only when they were ALL refused.
  //
  // Scope, measured rather than assumed (both 9.0.4 and 10.0.10 behave the
  // same): every call site in this codebase passes a single address, so today
  // a refused recipient does throw and is already logged. This check is what
  // keeps that true - the moment one caller passes two addresses, or a
  // comma-separated list, a silent partial rejection becomes reachable and
  // would be recorded as 'sent'. It also covers the no-recipients-accepted
  // case that a future transport could resolve rather than throw.
  //
  // Note for anyone debugging "no errors, but it never arrived": that symptom
  // is NOT this. A single rejected invitee raises EENVELOPE. Silence with no
  // delivery means the relay accepted the message (a 250, logged below) and it
  // died after handoff - SPF/DKIM/DMARC on the From domain, or spam filing.
  const accepted = Array.isArray(info.accepted) ? info.accepted : []
  const rejected = Array.isArray(info.rejected) ? info.rejected : []
  const pending = Array.isArray(info.pending) ? info.pending : []

  if (accepted.length === 0 || rejected.length > 0 || pending.length > 0) {
    // `response` is the server's own last line (e.g. "550 5.1.1 unknown
    // recipient", "450 greylisted") and is the only thing that says why.
    logger.error('email not accepted for delivery', {
      to,
      subject,
      from,
      smtpUser: smtpUser.value(),
      smtpHost: smtpHost.value(),
      accepted,
      rejected,
      pending,
      response: info.response,
      messageId: info.messageId,
    })
    const err = new Error(
      `SMTP did not accept delivery to ${rejected.concat(pending).join(', ') || to}: ${info.response || 'no recipients accepted'}`,
    )
    err.code = 'EENVELOPE'
    err.response = info.response
    err.rejected = rejected
    throw err
  }

  // `response` is kept on the success path too. A 250 here is only the relay
  // taking custody - if mail is accepted and still never arrives, the next
  // question is what the relay did with it, and the queue id in this line is
  // what the mail provider needs to answer that.
  logger.info('email sent', {
    to,
    subject,
    from,
    accepted,
    messageId: info.messageId,
    response: info.response,
  })
  return info
}

module.exports = { sendMail, smtpPassword }
