// One-off local script - NOT deployed as a Cloud Function. Verifies the SMTP
// credentials and sender identity that functions/src/utils/email.js will use,
// without going through a deploy cycle.
//
// WHY THIS EXISTS: "invitations aren't sending" is expensive to diagnose from
// the deployed side. Every invite creates a real Auth account and burns a
// password-reset link, the SMTP password lives in Secret Manager where it
// cannot be read back, and the two failure modes look identical from the
// dashboard - a wrong password and a sender the server refuses both surface as
// nothing arriving. This exercises the same two steps the real code does,
// against the same server, in about a second:
//
//   1. verify()  - opens the connection and authenticates. Fails here and the
//                  SMTP_PASSWORD secret does not match SMTP_USER's mailbox.
//   2. sendMail() - a real send to an address you name, and the envelope
//                  result is printed rather than assumed. `accepted` is the
//                  only proof a recipient was taken; `rejected` non-empty
//                  means the server declined it while still resolving the
//                  call, which is the silent failure email.js now catches.
//
// A 250 in `response` means the relay took custody, NOT that anyone received
// it. If this passes and mail still never lands, the problem is downstream -
// SPF/DKIM/DMARC for the From domain, or the relay's own queue - and the
// queue id in that response line is what the mail provider needs to trace it.
//
// Usage:
//   SMTP_PASSWORD='...' node scripts/checkSmtp.js you@example.com
//
// Reads SMTP_HOST/PORT/USER/FROM from the environment, falling back to the
// same defaults email.js uses. To test exactly what a given project deploys,
// source its env file first:
//   set -a; . .env.rectifia-59a1e; set +a
//   SMTP_PASSWORD='...' node scripts/checkSmtp.js you@example.com

const nodemailer = require('nodemailer')

const host = process.env.SMTP_HOST || 'mail.spacemail.com'
const port = Number(process.env.SMTP_PORT || '465')
const user = process.env.SMTP_USER || 'hello@rectifia.com'
const from = process.env.SMTP_FROM || 'Rectifia <hello@rectifia.com>'
const pass = process.env.SMTP_PASSWORD

const to = process.argv[2]

function fail(message) {
  console.error(`\n  FAIL  ${message}\n`)
  process.exit(1)
}

async function main() {
  if (!pass) {
    fail('Set SMTP_PASSWORD to the password for the mailbox in SMTP_USER.')
  }
  if (!to) {
    fail('Pass a recipient address: node scripts/checkSmtp.js you@example.com')
  }

  console.log('\nSMTP check')
  console.log(`  host   ${host}:${port} (${port === 465 ? 'implicit TLS' : 'STARTTLS'})`)
  console.log(`  user   ${user}`)
  console.log(`  from   ${from}`)
  console.log(`  to     ${to}`)

  // The From domain and the authenticated domain have to be the same one, or
  // the mail is unaligned for DMARC even when it sends cleanly. Worth saying
  // before the send rather than leaving it to be discovered later.
  const userDomain = user.split('@')[1]
  const fromDomain = (from.match(/<([^>]+)>/)?.[1] || from).split('@')[1]
  if (userDomain && fromDomain && userDomain !== fromDomain) {
    console.log(
      `\n  WARN  SMTP_USER is on ${userDomain} but SMTP_FROM is on ${fromDomain}.` +
        '\n        These must match, or the mail cannot align for DMARC.',
    )
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })

  try {
    await transporter.verify()
    console.log('\n  OK    connected and authenticated')
  } catch (err) {
    // The hint has to follow the actual failure: a timeout never reached the
    // server, so pointing at the password would send someone rotating a
    // secret that was never the problem.
    // Nodemailer normalises transport errors to its own codes and wraps a
    // refused connection as ESOCKET rather than the raw ECONNREFUSED, so the
    // reliable signal is the positive one: only EAUTH (or a 535) means the
    // server actually rejected the credentials. Everything else stopped short
    // of authenticating.
    const isAuthFailure = err.code === 'EAUTH' || err.responseCode === 535
    const hint = isAuthFailure
      ? '\n\n        A 535 here means SMTP_PASSWORD is not the password for' +
        `\n        ${user}. That is the secret to update in Secret Manager.`
      : `\n\n        The connection never reached ${host}:${port}, so this says` +
        '\n        nothing about the password. Check the host and port, and' +
        '\n        whether outbound SMTP is blocked from where you are running' +
        '\n        this (corporate networks and cloud shells commonly block 465).'
    fail(
      `could not connect or authenticate: ${err.message}` +
        `\n        code ${err.code || '-'}  responseCode ${err.responseCode || '-'}` +
        `\n        ${err.response || ''}` +
        hint,
    )
  }

  let info
  try {
    info = await transporter.sendMail({
      from,
      to,
      subject: 'Rectifia SMTP check',
      text:
        'This is a delivery check from scripts/checkSmtp.js.\n\n' +
        'If you are reading this, the sending path that staff invitations use is working.',
    })
  } catch (err) {
    fail(
      `send was refused: ${err.message}` +
        `\n        code ${err.code || '-'}  responseCode ${err.responseCode || '-'}` +
        `\n        ${err.response || ''}`,
    )
  }

  const accepted = info.accepted || []
  const rejected = info.rejected || []
  const pending = info.pending || []

  console.log(`  ${accepted.length ? 'OK   ' : 'FAIL '} accepted ${JSON.stringify(accepted)}`)
  if (rejected.length) console.log(`  FAIL  rejected ${JSON.stringify(rejected)}`)
  if (pending.length) console.log(`  FAIL  pending  ${JSON.stringify(pending)}`)
  console.log(`  ---   response ${info.response || '-'}`)
  console.log(`  ---   messageId ${info.messageId || '-'}`)

  if (!accepted.length || rejected.length || pending.length) {
    fail('the server did not accept delivery to that address.')
  }

  console.log(
    '\n  Handed off to the relay. If it does not arrive, check the spam folder,' +
      `\n  then SPF/DKIM/DMARC for ${fromDomain || 'the From domain'}:` +
      `\n    dig TXT ${fromDomain}` +
      `\n    dig TXT _dmarc.${fromDomain}` +
      '\n  Unauthenticated mail is accepted here and discarded at the recipient.\n',
  )
}

main().catch((err) => fail(err.stack || err.message))
