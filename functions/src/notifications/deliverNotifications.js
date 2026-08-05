const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { sendMail, smtpPassword } = require('../utils/email')
const { buildPulseCheckInviteEmail } = require('./templates/pulseCheckInvite')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const SUPER_ADMINS_COLLECTION = 'superAdmins'
const NOTIFICATIONS_COLLECTION = 'notifications'

// Base URL the reporter/staff app is served from - the pulse invite link and
// the staff-facing links are built against it. Deploy-time config with a
// sensible default for the hosted app, same defineString pattern as email.js.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://rectifia-59a1e.web.app' })

// Statuses this worker owns. 'pending' is a fresh queued send; 'failed' is a
// previous attempt we may retry; 'sending' is a claim in flight (reclaimed
// only if stale, i.e. a crash between claim and result). 'sent', 'resolved',
// and any already-exhausted 'failed' doc are deliberately left untouched:
//   - a 'failed' doc that has used up its attempts is left for manual
//     inspection rather than retried forever.
//
// 'awaiting_contact_info' is set by schedulePulseChecks.js for employees with
// no email on file. It is now also claimed here - but on a different track: a
// claimed awaiting_contact_info doc re-reads the employee roster doc, and only
// becomes a normal send if an email has since been filled in. If none has, it
// is returned to 'awaiting_contact_info' WITHOUT spending an attempt, so an
// employee the company simply hasn't given an address for is never exhausted
// by the retry cap for a reason outside their control.
const MAX_ATTEMPTS = 3

const AWAITING_CONTACT_STATUS = 'awaiting_contact_info'
const EMPLOYEES_SUBCOLLECTION = 'employees'

// A claim older than this in 'sending' is assumed abandoned (the run that
// claimed it crashed before writing a terminal status) and may be reclaimed,
// so a single crash doesn't strand a notification forever.
const STALE_SENDING_MS = 10 * 60 * 1000

function attemptsUsed(data) {
  return typeof data.attemptCount === 'number' ? data.attemptCount : 0
}

// A short, non-sensitive error label to persist on the doc. Never the email
// body and never an invite token - only a bounded reason string.
function shortError(err) {
  return String(err && err.message ? err.message : err).slice(0, 200)
}

// Per-run cache so repeated notifications for the same company don't re-read
// the company doc.
function makeCompanyNameLookup(firestore) {
  const cache = new Map()
  return async (companyId) => {
    if (!companyId) return null
    if (cache.has(companyId)) return cache.get(companyId)
    const snap = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
    const name = snap.exists ? snap.data().name ?? null : null
    cache.set(companyId, name)
    return name
  }
}

// Resolves the email addresses of every platform Super Admin. Membership is
// the allowlist doc at superAdmins/{uid} (see createCompanyAdmin.js); the
// address lives on the Auth account, so we read it from there, falling back to
// an email field on the doc if one was stored.
async function resolveSuperAdminEmails(firestore) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).get()
  const emails = []
  for (const doc of snapshot.docs) {
    const fieldEmail = doc.data().email
    if (fieldEmail) {
      emails.push(fieldEmail)
      continue
    }
    try {
      const user = await admin.auth().getUser(doc.id)
      if (user.email) emails.push(user.email)
    } catch (err) {
      logger.error('deliverNotifications: could not resolve super admin email', {
        uid: doc.id,
        error: err.message,
      })
    }
  }
  return emails
}

// Emails of every staff member in a company holding one of the given roles.
async function resolveStaffEmailsByRole(firestore, companyId, roles) {
  if (!companyId) return []
  const snapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .where('role', 'in', roles)
    .get()
  return snapshot.docs.map((d) => d.data().email).filter(Boolean)
}

function dedupe(emails) {
  return [...new Set(emails.filter(Boolean))]
}

// Builds the email(s) for one notification. Returns { recipients, subject,
// text, html }. Throws if the notification can't be delivered (e.g. no
// recipient resolvable) so the caller records it as a failed attempt.
//
// Content rules: the pulseCheckInvite send is REPORTER-FACING and must reveal
// nothing (no case reference, no answers, no 'case'/'report') - that content
// is owned entirely by templates/pulseCheckInvite.js. Every other type here is
// STAFF-FACING and may be normal and descriptive. Reporter case-thread
// notifications are NOT handled here at all - those belong to
// sendCaseUpdate.js and its decoy-template rotation.
async function buildEmailForNotification(firestore, data, { getCompanyName }) {
  switch (data.type) {
    case 'pulseCheckInvite': {
      if (!data.recipientEmail) throw new Error('no_recipient')
      const companyName = await getCompanyName(data.companyId)
      const { subject, text, html } = buildPulseCheckInviteEmail({
        companyName,
        inviteId: data.inviteId,
        token: data.inviteToken,
        baseUrl: appBaseUrl.value(),
      })
      return { recipients: [data.recipientEmail], subject, text, html }
    }

    case 'staffInvite': {
      if (!data.recipientEmail) throw new Error('no_recipient')
      const companyName = (await getCompanyName(data.companyId)) || 'your organization'
      const subject = `You've been invited to join ${companyName} on Rectifia`
      const text = [
        `You've been invited to join ${companyName} on Rectifia.`,
        '',
        'To accept the invitation, set your password using the link below:',
        data.inviteLink || '',
        '',
        "If you weren't expecting this invitation, you can safely ignore this email.",
      ].join('\n')
      return { recipients: [data.recipientEmail], subject, text, html: null }
    }

    case 'superAdminReview': {
      const recipients = await resolveSuperAdminEmails(firestore)
      if (recipients.length === 0) throw new Error('no_recipient')
      const subject = 'A case needs manual assignment'
      const text = [
        'A case could not be routed automatically and needs manual assignment.',
        '',
        `Case: ${data.caseId ?? 'unknown'}`,
        `Reason: ${data.reason ?? 'unknown'}`,
        data.category ? `Category: ${data.category}` : null,
        data.department ? `Department: ${data.department}` : null,
        '',
        'Open the Super Admin dashboard to assign it.',
      ]
        .filter((line) => line !== null)
        .join('\n')
      return { recipients, subject, text, html: null }
    }

    case 'companyAdminReview': {
      const recipients = dedupe(data.recipientEmails || [])
      if (recipients.length === 0) throw new Error('no_recipient')
      const subject = 'A case needs manual assignment'
      const text = [
        'A case could not be routed automatically and needs to be assigned.',
        '',
        `Case: ${data.caseId ?? 'unknown'}`,
        `Reason: ${data.reason ?? 'unknown'}`,
        data.category ? `Category: ${data.category}` : null,
        data.department ? `Department: ${data.department}` : null,
        '',
        'Open your admin dashboard to assign it.',
      ]
        .filter((line) => line !== null)
        .join('\n')
      return { recipients, subject, text, html: null }
    }

    case 'crisis': {
      if (!data.recipientEmail) throw new Error('no_recipient')
      const subject = 'Urgent: a case requires immediate attention'
      const text = [
        data.recipientName ? `Hello ${data.recipientName},` : 'Hello,',
        '',
        'A case has been flagged as requiring immediate attention.',
        '',
        `Case: ${data.caseId ?? 'unknown'}`,
        data.category ? `Category: ${data.category}` : null,
        '',
        'Please review it as soon as possible.',
      ]
        .filter((line) => line !== null)
        .join('\n')
      return { recipients: [data.recipientEmail], subject, text, html: null }
    }

    case 'acknowledgmentDeadlineRisk':
    case 'feedbackDeadlineRisk': {
      const recipients = await resolveStaffEmailsByRole(firestore, data.companyId, ['hrCoordinator'])
      if (recipients.length === 0) throw new Error('no_recipient')
      const which =
        data.type === 'acknowledgmentDeadlineRisk' ? 'acknowledgment' : 'feedback'
      const dueText = data.dueAt && data.dueAt.toDate ? data.dueAt.toDate().toISOString() : 'soon'
      const subject = `A case ${which} deadline is approaching or overdue`
      const text = [
        `A case ${which} deadline is approaching or has already passed.`,
        '',
        `Case: ${data.caseId ?? 'unknown'}`,
        `Due: ${dueText}`,
        '',
        'Open the HR Coordinator dashboard to follow up.',
      ].join('\n')
      return { recipients, subject, text, html: null }
    }

    default:
      return null
  }
}

// Attempts to claim a single notification for this run by transitioning it to
// 'sending' inside a transaction. Returns the claimed data (the pre-claim
// snapshot) if we won the claim, or null if another run already took it or it
// is no longer claimable. This is the guard that makes two overlapping runs
// safe: only the transaction that flips the status away from a claimable value
// wins, so a notification is never sent twice.
async function claimNotification(firestore, ref) {
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const data = snap.data()

    let claimable = false
    if (data.status === 'pending') {
      claimable = attemptsUsed(data) < MAX_ATTEMPTS
    } else if (data.status === 'failed') {
      claimable = attemptsUsed(data) < MAX_ATTEMPTS
    } else if (data.status === 'sending') {
      const claimedAtMs = data.claimedAt && data.claimedAt.toMillis ? data.claimedAt.toMillis() : 0
      const stale = Date.now() - claimedAtMs >= STALE_SENDING_MS
      claimable = stale && attemptsUsed(data) < MAX_ATTEMPTS
    } else if (data.status === AWAITING_CONTACT_STATUS) {
      // Always claimable, with no attemptCount gate: the whole point of the
      // awaiting-contact track is that it must never be exhausted by the retry
      // cap. Whether it turns into a send or is re-parked is decided after the
      // claim, once the employee roster doc has been re-read.
      claimable = true
    }

    if (!claimable) return null

    tx.update(ref, {
      status: 'sending',
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    return data
  })
}

// Gathers the candidate notifications for this run: freshly queued ('pending'),
// retryable ('failed' under the attempt cap), stale in-flight claims ('sending'
// past the staleness threshold), and parked pulse invites
// ('awaiting_contact_info', with no attempt gate). The last are picked up on
// every run so an address filled in on the roster is noticed promptly, and are
// re-parked without cost if it still isn't there.
async function loadCandidates(firestore) {
  const [pendingSnap, failedSnap, sendingSnap, awaitingSnap] = await Promise.all([
    firestore.collection(NOTIFICATIONS_COLLECTION).where('status', '==', 'pending').get(),
    firestore.collection(NOTIFICATIONS_COLLECTION).where('status', '==', 'failed').get(),
    firestore.collection(NOTIFICATIONS_COLLECTION).where('status', '==', 'sending').get(),
    firestore.collection(NOTIFICATIONS_COLLECTION).where('status', '==', AWAITING_CONTACT_STATUS).get(),
  ])

  const refs = new Map()
  pendingSnap.docs.forEach((d) => refs.set(d.id, d.ref))
  failedSnap.docs.forEach((d) => {
    if (attemptsUsed(d.data()) < MAX_ATTEMPTS) refs.set(d.id, d.ref)
  })
  sendingSnap.docs.forEach((d) => {
    const data = d.data()
    const claimedAtMs = data.claimedAt && data.claimedAt.toMillis ? data.claimedAt.toMillis() : 0
    const stale = Date.now() - claimedAtMs >= STALE_SENDING_MS
    if (stale && attemptsUsed(data) < MAX_ATTEMPTS) refs.set(d.id, d.ref)
  })
  awaitingSnap.docs.forEach((d) => refs.set(d.id, d.ref))
  return [...refs.values()]
}

// Re-reads the roster employee doc a parked pulse invite is waiting on and, if
// an email has since been filled in, persists it to the notification's
// recipientEmail so the normal delivery path can pick up from there. Returns
// the resolved email, or null if the roster still has none. Called only for
// notifications claimed out of 'awaiting_contact_info'.
async function resolveAwaitingContactEmail(firestore, ref, claimed) {
  if (!claimed.companyId || !claimed.employeeId) return null
  const employeeSnap = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(claimed.companyId)
    .collection(EMPLOYEES_SUBCOLLECTION)
    .doc(claimed.employeeId)
    .get()
  const email = employeeSnap.exists ? employeeSnap.data().email || null : null
  if (!email) return null
  await ref.update({ recipientEmail: email })
  return email
}

// Runs every 15 minutes. Claims each queued notification atomically, delivers
// it via the shared SMTP transport, and records a terminal status. Because
// email.js reads the SMTP password from Secret Manager, this function declares
// smtpPassword in its secrets array (same requirement inviteStaff.js has).
exports.deliverNotifications = onSchedule(
  { schedule: 'every 15 minutes', secrets: [smtpPassword] },
  async () => {
    const firestore = admin.firestore()
    const getCompanyName = makeCompanyNameLookup(firestore)

    const refs = await loadCandidates(firestore)
    let delivered = 0
    let failed = 0
    let skipped = 0

    for (const ref of refs) {
      const claimed = await claimNotification(firestore, ref)
      if (!claimed) {
        // Another overlapping run already took it, or it is no longer
        // claimable - nothing to do.
        continue
      }

      // A doc claimed out of 'awaiting_contact_info' takes a detour: it only
      // becomes a real send if the roster now has an address for the employee.
      // If it still doesn't, park it again without spending an attempt, so the
      // retry cap can never exhaust an invite over a missing address the
      // employee has no way to supply.
      if (claimed.status === AWAITING_CONTACT_STATUS) {
        const email = await resolveAwaitingContactEmail(firestore, ref, claimed)
        if (!email) {
          skipped += 1
          await ref.update({
            status: AWAITING_CONTACT_STATUS,
            claimedAt: admin.firestore.FieldValue.delete(),
          })
          continue
        }
        // Reflect the resolved address on the in-memory copy so the normal
        // delivery flow below builds the email for the right recipient.
        claimed.recipientEmail = email
      }

      const priorAttempts = attemptsUsed(claimed)

      let email
      try {
        email = await buildEmailForNotification(firestore, claimed, { getCompanyName })
      } catch (err) {
        // Could not build a deliverable email (e.g. no recipient resolvable).
        // Record as a failed attempt so it retries under the cap, then parks.
        failed += 1
        await ref.update({
          status: 'failed',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          attemptCount: priorAttempts + 1,
          deliveryError: shortError(err),
        })
        logger.warn('deliverNotifications: could not build email', {
          notificationId: ref.id,
          type: claimed.type,
          attemptCount: priorAttempts + 1,
        })
        continue
      }

      if (email === null) {
        // Unknown notification type - release the claim back to 'pending'
        // without burning an attempt, and leave it for a future code path.
        skipped += 1
        await ref.update({ status: 'pending', claimedAt: admin.firestore.FieldValue.delete() })
        logger.warn('deliverNotifications: unhandled notification type', {
          notificationId: ref.id,
          type: claimed.type,
        })
        continue
      }

      try {
        for (const recipient of email.recipients) {
          await sendMail({ to: recipient, subject: email.subject, text: email.text, html: email.html })
        }
        delivered += 1
        await ref.update({
          status: 'sent',
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          attemptCount: priorAttempts + 1,
        })
      } catch (err) {
        failed += 1
        await ref.update({
          status: 'failed',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          attemptCount: priorAttempts + 1,
          deliveryError: shortError(err),
        })
        // Log identifiers only - never the body content or invite token.
        logger.error('deliverNotifications: send failed', {
          notificationId: ref.id,
          type: claimed.type,
          attemptCount: priorAttempts + 1,
        })
      }
    }

    logger.info('deliverNotifications: run complete', {
      candidates: refs.length,
      delivered,
      failed,
      skipped,
    })
  }
)
