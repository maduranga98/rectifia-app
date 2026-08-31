// WHY THIS MATTERS: a Company Admin's report that "staff invitations aren't
// sending" had a delivery-side half. inviteStaff.js and resendStaffInvite.js
// both send over SMTP inline and, on failure, deliberately do NOT throw - the
// account and the invite link already exist - recording the outcome on a
// notifications doc with status 'failed' instead. deliverNotifications.js is
// the worker that picks those up and retries them.
//
// It only ever knew the 'staffInvite' type. A resend queued as
// 'staffInviteResend' fell through its switch to `default: return null`,
// which the worker reads as "unknown type" and parks back at 'pending'
// *without* spending an attempt - so a failed resend was re-claimed and
// re-parked on every 15-minute run, forever, and its email was never
// actually sent. These tests pin that both invite types now deliver.
import { describe, it, expect, beforeEach } from 'vitest'
import admin from 'firebase-admin'
import { deliverNotifications } from '../notifications/deliverNotifications.js'

const COMPANY_ID = 'company-1'
const NOTIFICATIONS = 'notifications'

function seedCompany() {
  const firestore = admin.__firestore()
  firestore.seed('companies', COMPANY_ID, { name: 'Acme Corp' })
  return firestore
}

async function readNotification(firestore, id) {
  const snapshot = await firestore.collection(NOTIFICATIONS).doc(id).get()
  return snapshot.data()
}

describe('deliverNotifications: staff invitation retries', () => {
  beforeEach(() => {
    admin.__reset()
  })

  it('delivers a failed staff invite that was queued for retry', async () => {
    const firestore = seedCompany()
    firestore.seed(NOTIFICATIONS, 'n1', {
      type: 'staffInvite',
      companyId: COMPANY_ID,
      recipientEmail: 'new.hire@acme.test',
      inviteLink: 'https://app.rectifia.com/invite/abc123',
      status: 'failed',
      attemptCount: 1,
    })

    await deliverNotifications({})

    const doc = await readNotification(firestore, 'n1')
    expect(doc.status).toBe('sent')
    expect(doc.attemptCount).toBe(2)
  })

  // The regression itself: before the 'staffInviteResend' case existed this
  // came back 'pending' with attemptCount untouched, every single run.
  it('delivers a resent staff invite rather than parking it as an unknown type', async () => {
    const firestore = seedCompany()
    firestore.seed(NOTIFICATIONS, 'n2', {
      type: 'staffInviteResend',
      companyId: COMPANY_ID,
      recipientEmail: 'new.hire@acme.test',
      inviteLink: 'https://app.rectifia.com/invite/def456',
      status: 'failed',
      attemptCount: 1,
    })

    await deliverNotifications({})

    const doc = await readNotification(firestore, 'n2')
    expect(doc.status).toBe('sent')
    expect(doc.attemptCount).toBe(2)
  })

  // A resend with no address on the doc must burn an attempt and park as
  // 'failed', the same as any other unresolvable recipient - not loop.
  it('fails a resend with no recipient instead of retrying it forever', async () => {
    const firestore = seedCompany()
    firestore.seed(NOTIFICATIONS, 'n3', {
      type: 'staffInviteResend',
      companyId: COMPANY_ID,
      inviteLink: 'https://app.rectifia.com/invite/ghi789',
      status: 'pending',
    })

    await deliverNotifications({})

    const doc = await readNotification(firestore, 'n3')
    expect(doc.status).toBe('failed')
    expect(doc.attemptCount).toBe(1)
  })

  // An genuinely unknown type must still be parked back at 'pending' without
  // burning an attempt - the behaviour the resend case was wrongly getting.
  it('still parks a genuinely unknown notification type back at pending', async () => {
    const firestore = seedCompany()
    firestore.seed(NOTIFICATIONS, 'n4', {
      type: 'somethingNobodyHandlesYet',
      companyId: COMPANY_ID,
      recipientEmail: 'new.hire@acme.test',
      status: 'pending',
    })

    await deliverNotifications({})

    const doc = await readNotification(firestore, 'n4')
    expect(doc.status).toBe('pending')
    expect(doc.attemptCount).toBeUndefined()
  })
})
