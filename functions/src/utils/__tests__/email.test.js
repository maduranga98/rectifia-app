// WHY THIS MATTERS: SMTP answers each RCPT TO separately, and nodemailer's
// sendMail resolves as long as at least ONE recipient was accepted - the ones
// the server declined come back in `info.rejected` with no exception thrown.
// It throws only when they were all refused. sendMail() used to return any
// resolved call as a plain success, so a partially refused send was recorded
// as delivered.
//
// Honest scope: every call site in this codebase currently passes a single
// address, where a refusal does throw and is already logged - so this is a
// guard, not the explanation for an invitation that never arrived. It stops
// the silent case becoming reachable the first time a caller passes two
// addresses or a comma-separated list, which is a one-word change away.
//
// These tests pin that a resolved SMTP call is not trusted on its own - the
// envelope result decides.
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { sendMail } from '../email.js'

// email.js is CommonJS, so its own `require('nodemailer')` is serviced by
// Node's loader and the support/setup.js resolver patch - NOT by vitest.config
// resolve.alias, which only covers ESM `import`. Reaching the mock through
// createRequire lands on the same module instance email.js holds; a plain
// `import nodemailer from 'nodemailer'` here would resolve through Vite to a
// second, independent copy whose __setNextResult() the code under test never
// sees. See support/setup.js's header for why both seams exist.
const nodemailer = createRequire(import.meta.url)('nodemailer')

const TO = 'new.hire@acme.test'

describe('sendMail: envelope result handling', () => {
  beforeEach(() => {
    nodemailer.__reset()
  })

  it('resolves when the server accepted the recipient', async () => {
    const info = await sendMail({ to: TO, subject: 'Invite', text: 'hi', html: '<p>hi</p>' })
    expect(info.accepted).toEqual([TO])
    expect(info.rejected).toEqual([])
  })

  // The regression: before this, a rejected recipient resolved as a success
  // and the caller wrote emailDelivered: true.
  it('throws when the server rejected the recipient, even though SMTP resolved', async () => {
    nodemailer.__setNextResult({
      accepted: [],
      rejected: [TO],
      response: '550 5.1.1 <new.hire@acme.test>: Recipient address rejected',
    })

    await expect(
      sendMail({ to: TO, subject: 'Invite', text: 'hi', html: '<p>hi</p>' }),
    ).rejects.toThrow(/550 5\.1\.1/)
  })

  it('throws when no recipient was accepted at all', async () => {
    nodemailer.__setNextResult({ accepted: [], rejected: [], response: '250 queued' })

    await expect(
      sendMail({ to: TO, subject: 'Invite', text: 'hi', html: '<p>hi</p>' }),
    ).rejects.toThrow(/did not accept delivery/)
  })

  // A recipient the server neither accepted nor refused outright (greylisting,
  // a deferred relay) has not been delivered either - reporting it as sent is
  // the same silent failure, so it is treated the same way.
  it('throws when a recipient is left pending rather than accepted', async () => {
    nodemailer.__setNextResult({
      accepted: [],
      rejected: [],
      pending: [TO],
      response: '450 4.2.0 Greylisted, try again later',
    })

    await expect(
      sendMail({ to: TO, subject: 'Invite', text: 'hi', html: '<p>hi</p>' }),
    ).rejects.toThrow(/450 4\.2\.0/)
  })

  it('surfaces the recipient and the server response on the thrown error', async () => {
    nodemailer.__setNextResult({
      accepted: [],
      rejected: [TO],
      response: '550 5.7.1 Sender address rejected: not owned by user',
    })

    await expect(
      sendMail({ to: TO, subject: 'Invite', text: 'hi', html: '<p>hi</p>' }),
    ).rejects.toMatchObject({
      code: 'EENVELOPE',
      rejected: [TO],
    })
  })
})
