const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const crypto = require('crypto')
const { requireAuthUid, loadCaseForHandler, logPrivilegedAction } = require('../utils/staffAuth')
const { encryptionKeySecret, encryptIdentity } = require('../utils/identityVault')
const { sendMail, smtpPassword } = require('../utils/email')
const { isFeatureEnabled, requireFeatureEnabled } = require('../utils/featureFlags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const MESSAGES_SUBCOLLECTION = 'messages'
const EXTERNAL_SHARES_COLLECTION = 'externalShares'

const MIN_PURPOSE_LENGTH = 20
const DEFAULT_EXPIRES_DAYS = 14
const MAX_EXPIRES_DAYS = 30
const MIN_EXPIRES_DAYS = 1
const MAX_ACTIVE_SHARES_PER_CASE = 3
const VALID_SCOPES = ['summary', 'full']
const TOKEN_BYTES = 32
const SCRYPT_KEY_LENGTH = 64
const DAY_MS = 24 * 60 * 60 * 1000

// Same base URL param deliverNotifications.js already declares - both
// modules build links against the same deployed app, so this reuses the
// param name rather than inventing a second one that could drift.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://rectifia-59a1e.web.app' })

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hashToken(token, salt) {
  return crypto.scryptSync(token, salt, SCRYPT_KEY_LENGTH).toString('hex')
}

function clampExpiresInDays(raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return DEFAULT_EXPIRES_DAYS
  return Math.min(MAX_EXPIRES_DAYS, Math.max(MIN_EXPIRES_DAYS, Math.round(value)))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildShareEmail({ companyName, recipientName, purpose, scope, expiresAtMs, link }) {
  const company = companyName || 'the organisation'
  const expiryText = new Date(expiresAtMs).toISOString().slice(0, 10)
  const subject = `You've been granted time-limited access to a case record (${company})`
  const text = [
    `Hello ${recipientName},`,
    '',
    `${company} has granted you view-only access to one case record for the following purpose:`,
    purpose,
    '',
    `Scope: ${scope === 'full' ? 'Full record, including the message thread' : 'Summary only (scores, dates, action taken, compliance log)'}`,
    `Access expires: ${expiryText}`,
    '',
    'Open the link below to view it. You will be asked to confirm your name and accept a confidentiality undertaking on first access.',
    link,
    '',
    'This link is personal to you, is watermarked with your name and organisation, cannot be downloaded, printed, or forwarded to gain further access, and can be revoked at any time.',
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="margin: 0 0 16px;">Time-limited access to a case record</h2>
      <p>Hello ${escapeHtml(recipientName)},</p>
      <p><strong>${escapeHtml(company)}</strong> has granted you view-only access to one case record for the following purpose:</p>
      <p style="padding: 10px 14px; background: #f2f4f7; border-radius: 6px;">${escapeHtml(purpose)}</p>
      <p>
        Scope: ${scope === 'full' ? 'Full record, including the message thread' : 'Summary only (scores, dates, action taken, compliance log)'}<br />
        Access expires: ${escapeHtml(expiryText)}
      </p>
      <p style="margin: 24px 0;">
        <a href="${escapeHtml(link)}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 6px; display: inline-block;">Open case record</a>
      </p>
      <p style="font-size: 13px; color: #666;">You will be asked to confirm your name and accept a confidentiality undertaking on first access.</p>
      <p style="font-size: 13px; color: #666;">This link is personal to you, is watermarked with your name and organisation, cannot be downloaded, printed, or forwarded to gain further access, and can be revoked at any time.</p>
    </div>
  `

  return { subject, text, html }
}

// Appends the same content-free 'system' message every administrative
// event on a case writes (see applyRetention.js's Tier 1 purge notice) - the
// reporter reads their own case thread and sees that a share happened, to
// whom by organisation, and when it expires, without ever seeing the
// recipient's name or email, which belong to the handler's own record, not
// the reporter's.
async function appendShareSystemMessage(caseRef, text) {
  await caseRef.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'system',
    type: 'manual_log',
    text,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Grants a named external party time-limited, revocable, view-only access to
// exactly one case. Authorization is loadCaseForHandler PLUS an explicit
// role check for 'caseHandler'. HANDLER_ROLES itself no longer contains
// anything but 'caseHandler', so this re-check no longer guards against a
// wider HANDLER_ROLES letting Company Admin through - but it stays, on
// purpose, as an explicit, cheap re-assertion at the point of use for a
// callable that grants something this sensitive (external, revocable access
// to case content). Defense-in-depth here would have caught the original bug
// even before HANDLER_ROLES was fixed.
exports.createExternalShare = onCall({ secrets: [encryptionKeySecret, smtpPassword] }, async (request) => {
  const uid = requireAuthUid(request)
  const {
    caseId,
    recipientName,
    recipientEmail,
    recipientOrganisation,
    purpose,
    expiresInDays,
    scope,
  } = request.data || {}

  const cleanName = typeof recipientName === 'string' ? recipientName.trim().slice(0, 200) : ''
  const cleanEmail = typeof recipientEmail === 'string' ? recipientEmail.trim().slice(0, 320) : ''
  const cleanOrg = typeof recipientOrganisation === 'string' ? recipientOrganisation.trim().slice(0, 200) : ''
  const cleanPurpose = typeof purpose === 'string' ? purpose.trim() : ''

  if (!cleanName) {
    throw new HttpsError('invalid-argument', "The recipient's name is required")
  }
  if (!EMAIL_PATTERN.test(cleanEmail)) {
    throw new HttpsError('invalid-argument', "A valid email address for the recipient is required")
  }
  if (!cleanOrg) {
    throw new HttpsError('invalid-argument', "The recipient's organisation is required")
  }
  if (cleanPurpose.length < MIN_PURPOSE_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `A purpose of at least ${MIN_PURPOSE_LENGTH} characters is required - this is a legal disclosure, not a formality`
    )
  }
  if (!VALID_SCOPES.includes(scope)) {
    throw new HttpsError('invalid-argument', `scope must be one of ${VALID_SCOPES.join(', ')}`)
  }

  const firestore = admin.firestore()
  const { caseRef, snapshot, role } = await loadCaseForHandler(firestore, caseId, uid, 'external_share_create')

  // Explicit, deliberate re-assertion rather than trusting HANDLER_ROLES
  // alone - see the module comment above for why this stays even though
  // HANDLER_ROLES is now caseHandler-only.
  if (role !== 'caseHandler') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: snapshot.data().companyId ?? null,
      role,
      action: 'external_share_create',
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'role_not_case_handler',
    })
    throw new HttpsError('permission-denied', 'Only the assigned Case Handler may create an external share')
  }

  const caseData = snapshot.data()

  // Before any token is minted, any encryption happens, or any email is
  // sent: a company that has turned external share links off must not be
  // able to create a new one through this callable, even though the "share"
  // tab is hidden client-side. Existing shares already granted are untouched
  // - revocation is its own explicit action (revokeExternalShare.js), not a
  // side effect of this flag.
  requireFeatureEnabled(
    await isFeatureEnabled(firestore, caseData.companyId ?? null, 'externalShareLinks'),
    'externalShareLinks'
  )

  // Max 3 active shares per case - more than that is not a legal
  // consultation, it is distribution.
  const activeSnapshot = await firestore
    .collection(EXTERNAL_SHARES_COLLECTION)
    .where('caseId', '==', caseId)
    .where('status', '==', 'active')
    .get()
  if (activeSnapshot.size >= MAX_ACTIVE_SHARES_PER_CASE) {
    throw new HttpsError(
      'failed-precondition',
      `This case already has ${MAX_ACTIVE_SHARES_PER_CASE} active external shares. Revoke one before creating another.`
    )
  }

  const expiresDays = clampExpiresInDays(expiresInDays)
  const expiresAtMs = Date.now() + expiresDays * DAY_MS

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  const tokenSalt = crypto.randomBytes(16).toString('hex')
  const tokenHash = hashToken(token, tokenSalt)

  const shareRef = firestore.collection(EXTERNAL_SHARES_COLLECTION).doc()
  await shareRef.set({
    caseId,
    companyId: caseData.companyId ?? null,
    createdByUid: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    recipientName: cleanName,
    // Encrypted with the same split-key vault reporter identity uses - an
    // external recipient's contact address is exactly the kind of field this
    // system already treats as sensitive, and it should be no easier to read
    // in bulk here than anywhere else. Nothing in this module ever decrypts
    // it back: it was already known in plaintext at send time (this call),
    // and no later code path needs it again.
    recipientEmail: { vault: encryptIdentity(cleanEmail) },
    recipientOrganisation: cleanOrg,
    purpose: cleanPurpose,
    scope,
    tokenHash,
    tokenSalt,
    expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
    status: 'active',
    revokedByUid: null,
    revokedAt: null,
    revokedReason: null,
    acceptedName: null,
    acceptedAt: null,
    accessCount: 0,
    lastAccessedAt: null,
  })

  const companySnap = caseData.companyId
    ? await firestore.collection('companies').doc(caseData.companyId).get()
    : null
  const companyName = companySnap?.exists ? companySnap.data().name ?? null : null

  const link = `${appBaseUrl.value()}/shared/${shareRef.id}?token=${token}`
  const { subject, text, html } = buildShareEmail({
    companyName,
    recipientName: cleanName,
    purpose: cleanPurpose,
    scope,
    expiresAtMs,
    link,
  })

  let emailDelivered = true
  try {
    await sendMail({ to: cleanEmail, subject, text, html })
  } catch (err) {
    emailDelivered = false
    logger.error('createExternalShare: delivery failed', { shareId: shareRef.id, error: err.message })
  }

  await appendShareSystemMessage(
    caseRef,
    `An external share was created for ${cleanOrg}, expiring ${new Date(expiresAtMs).toISOString().slice(0, 10)}.`
  )

  return {
    shareId: shareRef.id,
    expiresAt: expiresAtMs,
    emailDelivered,
  }
})

// Lists every share (active and past) for one case - the roster
// ShareCasePanel.jsx renders. Same authorization and the same explicit
// caseHandler-only re-check as creation, kept for the same defense-in-depth
// reason.
exports.listCaseShares = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { caseId } = request.data || {}
  const firestore = admin.firestore()

  const { snapshot, role } = await loadCaseForHandler(firestore, caseId, uid, 'external_share_list')
  if (role !== 'caseHandler') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: snapshot.data().companyId ?? null,
      role,
      action: 'external_share_list',
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'role_not_case_handler',
    })
    throw new HttpsError('permission-denied', 'Only the assigned Case Handler may view this case\'s external shares')
  }

  let sharesSnapshot
  try {
    sharesSnapshot = await firestore
      .collection(EXTERNAL_SHARES_COLLECTION)
      .where('caseId', '==', caseId)
      .orderBy('createdAt', 'desc')
      .get()
  } catch (err) {
    // A callable that throws a plain (non-HttpsError) error is collapsed by
    // the Functions framework into a bare 500 with no detail reaching the
    // client - the exact failure mode this query hits if the composite index
    // on (caseId, createdAt) declared in firestore.indexes.json was never
    // actually deployed (`firebase deploy --only firestore:indexes`) or is
    // still building. Logging the real error here is what makes that
    // diagnosable from Cloud Functions logs instead of a dead end.
    logger.error('listCaseShares: query failed', { caseId, error: err.message })
    throw err
  }

  const shares = sharesSnapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      shareId: doc.id,
      recipientName: data.recipientName ?? null,
      recipientOrganisation: data.recipientOrganisation ?? null,
      purpose: data.purpose ?? null,
      scope: data.scope ?? null,
      status: data.status ?? null,
      createdAt: data.createdAt?.toMillis?.() ?? null,
      expiresAt: data.expiresAt?.toMillis?.() ?? null,
      accessCount: data.accessCount ?? 0,
      lastAccessedAt: data.lastAccessedAt?.toMillis?.() ?? null,
      acceptedAt: data.acceptedAt?.toMillis?.() ?? null,
      acceptedName: data.acceptedName ?? null,
      revokedAt: data.revokedAt?.toMillis?.() ?? null,
      revokedReason: data.revokedReason ?? null,
      // Deliberately no recipientEmail, tokenHash, or tokenSalt in this
      // response - the handler already knows the email they typed in, and
      // returning the hash/salt would put brute-forceable material in a
      // client response for no operational reason.
    }
  })

  return { shares }
})

exports.EXTERNAL_SHARES_COLLECTION = EXTERNAL_SHARES_COLLECTION
exports.MAX_ACTIVE_SHARES_PER_CASE = MAX_ACTIVE_SHARES_PER_CASE
exports.hashToken = hashToken
