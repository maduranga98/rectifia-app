const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { resolveStaffEffectivePermissions, hasPermission } = require('../utils/permissionResolver')
const { resolveRetentionPolicy, CONFIGURABLE_KEYS } = require('./retentionPolicy')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const CASES_COLLECTION = 'cases'
const PULSE_RESPONSES_COLLECTION = 'pulseResponses'
const DAY_MS = 24 * 60 * 60 * 1000

// Wide enough that a real company's next-sweep preview is exact in the
// overwhelming majority of cases, bounded so a preview call can never scan a
// company's entire case history unbounded. A result at this ceiling is
// reported as a floor (`truncated: true`), never presented as exact.
const PREVIEW_QUERY_LIMIT = 2000

function daysAgo(days) {
  return admin.firestore.Timestamp.fromMillis(Date.now() - days * DAY_MS)
}

function onLegalHold(data) {
  return data?.legalHold?.active === true
}

function summarize(docs, field) {
  const eligible = docs.filter((doc) => !onLegalHold(doc.data()))
  if (eligible.length === 0) {
    return { count: 0, oldest: null, newest: null }
  }
  // Query is ordered ascending on `field`, so the first and last surviving
  // rows are the oldest and newest *within this batch*. When the batch was
  // truncated at PREVIEW_QUERY_LIMIT, `newest` is the newest among the
  // oldest N matches, not the true newest overall - truncated:true on the
  // caller's response is what marks every number here as a floor.
  return {
    count: eligible.length,
    oldest: eligible[0].data()[field]?.toMillis?.() ?? null,
    newest: eligible[eligible.length - 1].data()[field]?.toMillis?.() ?? null,
  }
}

async function previewCaseTier(firestore, companyId, { requireUnpurgedIdentity, cutoff }) {
  let query = firestore
    .collection(CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('status', '==', 'closed')
  if (requireUnpurgedIdentity) {
    query = query.where('identityPurgedAt', '==', null)
  }
  const snapshot = await query
    .where('closedAt', '<=', cutoff)
    .orderBy('closedAt', 'asc')
    .limit(PREVIEW_QUERY_LIMIT)
    .select('closedAt', 'legalHold')
    .get()

  return { ...summarize(snapshot.docs, 'closedAt'), truncated: snapshot.size === PREVIEW_QUERY_LIMIT }
}

async function previewPulseResponses(firestore, companyId, cutoff) {
  const snapshot = await firestore
    .collection(PULSE_RESPONSES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('submittedAt', '<=', cutoff)
    .orderBy('submittedAt', 'asc')
    .limit(PREVIEW_QUERY_LIMIT)
    .select('submittedAt')
    .get()

  const count = snapshot.size
  return {
    count,
    oldest: snapshot.docs[0]?.data().submittedAt?.toMillis?.() ?? null,
    newest: snapshot.docs[count - 1]?.data().submittedAt?.toMillis?.() ?? null,
    truncated: count === PREVIEW_QUERY_LIMIT,
  }
}

// Dry run: returns counts of what the NEXT sweep would delete at a given set
// of settings, by tier, with the oldest and newest affected close/submit
// dates - and deletes nothing. Company Admin only, and only for their own
// company: companyId in the request is verified against the caller's own
// custom claim rather than trusted outright, the same pattern
// functions/src/policy/managePolicyDocument.js uses, so this can never be
// used to probe another company's case volume.
//
// `proposedRetention` is optional and lets RetentionPage.jsx preview a
// setting the admin has typed but not yet saved - the exact gate the module
// requires: an admin cutting the case window from 7 years to 3 must see "this
// will permanently delete N cases on the next run" before Save is even
// enabled, not after. Values outside their floor/ceiling are clamped by
// resolveRetentionPolicy exactly as a saved value would be, so the preview
// can never show a rosier picture than what would actually be enforced.
exports.previewRetention = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, proposedRetention } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only preview retention for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'preview_retention')
  // A retentionSettings custom-role holder may preview a proposed window the
  // same as a Company Admin - the floors in isValidRetentionUpdate() (see
  // firestore.rules) apply to their eventual save exactly the same way, this
  // just extends who may run the read-only dry run.
  const resolved = role === 'companyAdmin' ? null : await resolveStaffEffectivePermissions(firestore, companyId, uid)
  const authorized = role === 'companyAdmin' || hasPermission(resolved, 'retentionSettings')
  if (!authorized) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'preview_retention',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may preview retention')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'preview_retention', outcome: 'granted' })

  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'No such company')
  }

  const overrides = {}
  if (proposedRetention && typeof proposedRetention === 'object') {
    for (const key of CONFIGURABLE_KEYS) {
      if (proposedRetention[key] !== undefined) overrides[key] = proposedRetention[key]
    }
  }
  const policy = resolveRetentionPolicy({
    ...companySnapshot.data(),
    retention: { ...companySnapshot.data().retention, ...overrides },
  })

  const [tier1, tier2, pulseResponses] = await Promise.all([
    previewCaseTier(firestore, companyId, {
      requireUnpurgedIdentity: true,
      cutoff: daysAgo(policy.identityRetentionDays),
    }),
    previewCaseTier(firestore, companyId, {
      requireUnpurgedIdentity: false,
      cutoff: daysAgo(policy.caseRetentionDays),
    }),
    previewPulseResponses(firestore, companyId, daysAgo(policy.pulseResponseRetentionDays)),
  ])

  return { policy, tier1, tier2, pulseResponses }
})
