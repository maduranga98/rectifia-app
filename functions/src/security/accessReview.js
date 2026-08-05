const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const {
  requireAuthUid,
  loadCallerRole,
  logPrivilegedAction,
  PRIVILEGED_ACTION_LOG_COLLECTION,
} = require('../utils/staffAuth')
const { recordControlRun } = require('./controlRunLog')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const STAFF_SUBCOLLECTION = 'staff'
const ACCESS_REVIEWS_COLLECTION = 'accessReviews'
const NOTIFICATIONS_COLLECTION = 'notifications'
const CONTROL_NAME = 'accessReview'

// CC6.2 (provisioning is authorized) and CC6.3 (access is periodically
// reviewed and revoked when no longer needed) are both tested by an auditor
// asking for exactly one artifact: a dated, per-account, attested review.
// This module produces that artifact on its own clock rather than requiring
// someone to assemble it by hand before an audit window opens.
const DORMANT_THRESHOLD_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

// A company with more staff than this in one review is unusual enough that
// the run logs it rather than silently truncating - see buildCompanyReview.
const MAX_STAFF_PER_REVIEW = 1000
// A platform with more companies than this in one run is out of scope for a
// single scheduled invocation's time budget; the next quarter's run picks up
// where this constant, not any per-company state, would otherwise stop it.
const MAX_COMPANIES_PER_RUN = 500

function currentPeriod(now = new Date()) {
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1
  return `${now.getUTCFullYear()}-Q${quarter}`
}

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

// The single-account slice of a review: role, status, last login (from the
// Firebase Auth record - the only trustworthy source for "when did this
// account last actually sign in"), last privileged action (from
// privilegedActionLog, module 26's new chokepoint-level audit trail), and
// whether either signal is stale enough to count as dormant. No case content
// is read to build this - staff docs hold account metadata only.
async function buildAccountEntry(firestore, companyId, staffDoc) {
  const uid = staffDoc.id
  const data = staffDoc.data()

  let lastLoginAt = null
  let authAccountFound = true
  try {
    const user = await admin.auth().getUser(uid)
    lastLoginAt = user.metadata?.lastSignInTime
      ? new Date(user.metadata.lastSignInTime).getTime()
      : null
  } catch (err) {
    // A staff doc with no matching Auth account is itself a finding worth
    // surfacing to the reviewer, not a reason to skip the row - it's exactly
    // the kind of drift an access review exists to catch.
    authAccountFound = false
    logger.warn('accessReview: no Auth account for staff doc', { companyId, uid, error: err.message })
  }

  let lastPrivilegedActionAt = null
  try {
    const snapshot = await firestore
      .collection(PRIVILEGED_ACTION_LOG_COLLECTION)
      .where('uid', '==', uid)
      .orderBy('at', 'desc')
      .limit(1)
      .get()
    if (!snapshot.empty) {
      lastPrivilegedActionAt = toMillis(snapshot.docs[0].data().at)
    }
  } catch (err) {
    logger.warn('accessReview: privileged action lookup failed', { companyId, uid, error: err.message })
  }

  const referenceAt = lastLoginAt ?? toMillis(data.invitedAt)
  const dormant = authAccountFound
    ? referenceAt === null || Date.now() - referenceAt > DORMANT_THRESHOLD_DAYS * DAY_MS
    : true

  return {
    uid,
    email: data.email ?? null,
    role: data.role ?? null,
    status: data.status ?? null,
    authAccountFound,
    lastLoginAt,
    lastPrivilegedActionAt,
    dormant,
  }
}

async function buildCompanyReview(firestore, companyDoc) {
  const companyId = companyDoc.id
  const staffSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(STAFF_SUBCOLLECTION)
    .limit(MAX_STAFF_PER_REVIEW)
    .get()

  if (staffSnapshot.size >= MAX_STAFF_PER_REVIEW) {
    logger.warn('accessReview: company staff roster exceeds review cap, list is a floor', {
      companyId,
      cap: MAX_STAFF_PER_REVIEW,
    })
  }

  const accounts = []
  for (const staffDoc of staffSnapshot.docs) {
    // eslint-disable-next-line no-await-in-loop
    accounts.push(await buildAccountEntry(firestore, companyId, staffDoc))
  }

  return {
    companyId,
    accounts,
    dormantCount: accounts.filter((a) => a.dormant).length,
    accountCount: accounts.length,
  }
}

// Runs quarterly. Walks every company, compiles a per-account roster with the
// signals CC6.2/CC6.3 are tested against, and writes one accessReviews
// document per company for this quarter - even a company with zero staff or
// zero dormant accounts gets a document, because "the control ran and found
// nothing to flag" is itself the evidence an auditor is asking for, and a
// missing document is indistinguishable from a broken job.
exports.accessReview = onSchedule('0 6 1 1,4,7,10 *', async () => {
  const firestore = admin.firestore()
  const period = currentPeriod()
  const companiesSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .limit(MAX_COMPANIES_PER_RUN)
    .get()

  let companiesReviewed = 0
  let totalAccounts = 0
  let totalDormant = 0
  let failures = 0

  for (const companyDoc of companiesSnapshot.docs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const review = await buildCompanyReview(firestore, companyDoc)
      const reviewId = `${companyDoc.id}_${period}`

      // eslint-disable-next-line no-await-in-loop
      await firestore
        .collection(ACCESS_REVIEWS_COLLECTION)
        .doc(reviewId)
        .set({
          companyId: review.companyId,
          period,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          accounts: review.accounts,
          accountCount: review.accountCount,
          dormantCount: review.dormantCount,
          status: 'pending_attestation',
          attestation: null,
        })

      // eslint-disable-next-line no-await-in-loop
      await firestore.collection(NOTIFICATIONS_COLLECTION).add({
        type: 'accessReviewPending',
        companyId: review.companyId,
        reviewId,
        period,
        dormantCount: review.dormantCount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
      })

      companiesReviewed += 1
      totalAccounts += review.accountCount
      totalDormant += review.dormantCount
    } catch (err) {
      failures += 1
      logger.error('accessReview: company review failed', { companyId: companyDoc.id, error: err.message })
    }
  }

  await recordControlRun(firestore, {
    control: CONTROL_NAME,
    outcome: failures === 0 ? 'ok' : 'partial_failure',
    summary: { period, companiesReviewed, totalAccounts, totalDormant, failures },
  })
})

// firestore.rules deliberately grants accessReviews no client read path at
// all, not even for a Company Admin reading their own company's row -
// module 26's rules keep this collection at the same "Super Admin read,
// Admin-SDK write only" posture as securityAlerts and keyRotationLog. This
// callable is therefore the only way a Company Admin ever sees what they are
// being asked to attest: it re-checks their staff role server-side (never
// trusting a client-supplied company match) and hands back the same roster
// attestAccessReview will act on.
exports.getAccessReviewForAttestation = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { reviewId } = request.data || {}
  const firestore = admin.firestore()

  if (typeof reviewId !== 'string' || !reviewId) {
    throw new HttpsError('invalid-argument', 'reviewId is required')
  }
  const snapshot = await firestore.collection(ACCESS_REVIEWS_COLLECTION).doc(reviewId).get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such access review')
  }
  const review = snapshot.data()

  const role = await loadCallerRole(firestore, review.companyId, uid, 'read_access_review')
  if (role !== 'companyAdmin') {
    throw new HttpsError('permission-denied', 'Only a Company Admin may view this access review')
  }

  return {
    reviewId,
    companyId: review.companyId,
    period: review.period,
    status: review.status,
    accounts: review.accounts,
    accountCount: review.accountCount,
    dormantCount: review.dormantCount,
    attestation: review.attestation ?? null,
  }
})

// A Company Admin's (or Super Admin's) sign-off on one quarter's review: who
// attested, when, and a keep/revoke decision per account. This is the CC6.3
// half of the artifact - the review alone shows the roster was compiled, the
// attestation shows a human actually looked at it. Attestations are final:
// once recorded, the review document does not accept a second one, so an
// auditor reading `attestation` can trust it reflects one deliberate act, not
// whichever write happened to land last.
//
// This deliberately does not revoke anything itself - see keyRotation.js and
// anomalyDetection.js for the same constraint. A "revoke" decision here is a
// recorded intent for a human to act on elsewhere (the Staff page), not an
// automated deactivation.
exports.attestAccessReview = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { reviewId, decisions } = request.data || {}
  const firestore = admin.firestore()

  if (typeof reviewId !== 'string' || !reviewId) {
    throw new HttpsError('invalid-argument', 'reviewId is required')
  }
  if (!Array.isArray(decisions)) {
    throw new HttpsError('invalid-argument', 'decisions must be an array of { uid, decision, note }')
  }

  const reviewRef = firestore.collection(ACCESS_REVIEWS_COLLECTION).doc(reviewId)
  const snapshot = await reviewRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such access review')
  }
  const review = snapshot.data()

  const role = await loadCallerRole(firestore, review.companyId, uid, 'attest_access_review')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: review.companyId,
      role,
      action: 'attest_access_review',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may attest an access review')
  }

  if (review.status === 'attested') {
    throw new HttpsError('failed-precondition', 'This access review has already been attested')
  }

  const knownUids = new Set((review.accounts || []).map((a) => a.uid))
  const cleanDecisions = decisions
    .filter((d) => d && typeof d.uid === 'string' && knownUids.has(d.uid))
    .map((d) => ({
      uid: d.uid,
      decision: d.decision === 'revoke' ? 'revoke' : 'keep',
      note: typeof d.note === 'string' ? d.note.slice(0, 500) : null,
    }))

  await reviewRef.update({
    status: 'attested',
    attestation: {
      reviewerUid: uid,
      reviewerEmail: request.auth?.token?.email ?? null,
      attestedAt: admin.firestore.FieldValue.serverTimestamp(),
      decisions: cleanDecisions,
    },
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId: review.companyId,
    role,
    action: 'attest_access_review',
    outcome: 'granted',
    detail: `decisions:${cleanDecisions.length}`,
  })

  return { status: 'attested', decisionCount: cleanDecisions.length }
})

exports.ACCESS_REVIEWS_COLLECTION = ACCESS_REVIEWS_COLLECTION
exports.DORMANT_THRESHOLD_DAYS = DORMANT_THRESHOLD_DAYS
