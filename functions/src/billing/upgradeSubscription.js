const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  PROGRESSIVE_THRESHOLD_EMPLOYEES,
  PUBLISHED_BANDS,
  PULSE_CHECK_BANDS,
} = require('./pricingEngine')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const BILLING_HISTORY_SUBCOLLECTION = 'billingHistory'

// The two independent things a Company Admin can self-serve here - Core plan
// band and the Pulse Check add-on band - each with its own published-band
// table and its own pair of company-doc fields. Never mixed into one write:
// a company can move Core without touching Pulse Check and vice versa, per
// the package-selection UI's design (PackageSelector.jsx / PulseCheckToggle.jsx
// are two separate components for exactly this reason).
const TARGETS = {
  core: {
    bands: PUBLISHED_BANDS,
    tierField: 'subscriptionTier',
    updatedAtField: 'subscriptionUpdatedAt',
    historyAction: 'core_tier_change',
  },
  pulseCheck: {
    bands: PULSE_CHECK_BANDS,
    tierField: 'pulseCheckTier',
    updatedAtField: 'pulseCheckUpdatedAt',
    historyAction: 'pulse_check_tier_change',
  },
}

// This is a self-declared entitlement selection, not a real headcount
// measurement - v1 has no automated roster-driven verification for it, only
// what a Company Admin has typed in on the package-selection UI. It is
// deliberately a different field from the real active-employee count
// pricingEngine.js's countActiveEmployees() computes (which is what the
// existing Stripe subscription in createCheckoutSession.js/
// togglePulseCheckAddOn.js/syncSubscriptionPricing.js actually bills from) -
// this module's writes never touch Stripe or that roster-derived price.
function readDeclaredEmployeeCount(company) {
  const count = Number(company?.employeeCount)
  return Number.isFinite(count) && Number.isInteger(count) && count >= 1 ? count : null
}

// Finds the band `tier` names within `bands`, or null if `tier` isn't a
// published band name at all (e.g. 'enterprise', or a typo).
function bandForTier(bands, tier) {
  return bands.find((band) => band.tier === tier) ?? null
}

// Whether `employeeCount` actually falls inside `band`'s declared range -
// this is the check that stops a company at 40 employees self-selecting
// Scale, or a company at 300 self-selecting Starter. `employeeCount` must
// also be at or below the self-serve threshold; above it, self-serve band
// selection isn't offered at all (see requestEnterpriseQuote.js) regardless
// of which band the math would otherwise land in.
function employeeCountMatchesBand(employeeCount, band) {
  return (
    employeeCount <= PROGRESSIVE_THRESHOLD_EMPLOYEES &&
    employeeCount >= band.minEmployees &&
    employeeCount <= band.maxEmployees
  )
}

async function writeAuditEntry(firestore, companyId, entry) {
  await firestore
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(BILLING_HISTORY_SUBCOLLECTION)
    .add({
      ...entry,
      at: admin.firestore.FieldValue.serverTimestamp(),
    })
}

// Instant, self-serve Core-plan or Pulse Check band change for a company at
// or below the 500-employee self-serve threshold. Company Admin only - this
// changes what the company is entitled to, which is stricter than the
// view-only billingView permission module togglePulseCheckAddOn.js's own
// comment discusses for the read-only quote.
//
// Does NOT touch Stripe, a payment method, or an invoice - this only writes
// the declared plan/add-on tier onto the company doc and logs the change.
// See the top-of-module comment on functions/src/billing/calculateQuote.js
// for the pre-existing, still-untouched Stripe-driven billing flow this
// deliberately does not interact with; the two are separate, parallel
// tracks by design (see the PR description for why).
//
// TODO(proration): changes take effect immediately with no prorated credit
// or charge for the switch - there is no payment processing in this module
// at all yet (see file-level comment), so there is nothing to prorate
// against. When real billing is wired to this selection, a downgrade or
// upgrade mid-cycle will need a proration policy; until then the UI must say
// so plainly rather than implying a fair mid-cycle adjustment happens.
exports.upgradeSubscription = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId, target, tier, enable } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only manage billing for your own company')
  }
  const targetConfig = TARGETS[target]
  if (!targetConfig) {
    throw new HttpsError('invalid-argument', "target must be 'core' or 'pulseCheck'")
  }
  // Core has no on/off switch - it's always exactly one of the three bands.
  // Pulse Check is opt-in, so `enable: false` is a valid, tier-less request
  // to turn it off; anything else (including Core) must supply a tier.
  const disablingPulseCheck = target === 'pulseCheck' && enable === false
  if (!disablingPulseCheck && (typeof tier !== 'string' || !tier)) {
    throw new HttpsError('invalid-argument', 'tier is required')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'upgrade_subscription')
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'upgrade_subscription',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may change the subscription plan')
  }

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)
  const companySnapshot = await companyRef.get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnapshot.data()
  const previousTier = company[targetConfig.tierField] ?? null

  if (disablingPulseCheck) {
    await companyRef.update({
      pulseCheckEnabled: false,
      pulseCheckTier: null,
      pulseCheckUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    await writeAuditEntry(firestore, companyId, {
      action: targetConfig.historyAction,
      changedByUid: uid,
      changedByRole: role,
      fromTier: previousTier,
      toTier: null,
      enabled: false,
    })
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'upgrade_subscription',
      outcome: 'granted',
      detail: 'pulse_check_disabled',
    })
    return { target, enabled: false, tier: null }
  }

  const band = bandForTier(targetConfig.bands, tier)
  if (!band) {
    throw new HttpsError('invalid-argument', `Unknown ${target} band '${tier}'`)
  }

  const employeeCount = readDeclaredEmployeeCount(company)
  if (employeeCount === null) {
    throw new HttpsError(
      'failed-precondition',
      'Declare your company\'s employee count before selecting a plan'
    )
  }
  if (employeeCount > PROGRESSIVE_THRESHOLD_EMPLOYEES) {
    throw new HttpsError(
      'failed-precondition',
      'Self-serve plan changes are not available above 500 employees - request an enterprise quote instead'
    )
  }
  // The core validation this callable exists for: the selected band must
  // actually be the one the company's declared headcount falls in. This is
  // never trusted from the client beyond "which band did they click" - the
  // range check itself is re-derived from `company.employeeCount` as read
  // from Firestore, not anything the request body claims.
  if (!employeeCountMatchesBand(employeeCount, band)) {
    throw new HttpsError(
      'failed-precondition',
      `${band.label} covers ${band.minEmployees}-${band.maxEmployees} employees; your declared headcount is ${employeeCount}`
    )
  }

  const update = {
    [targetConfig.tierField]: band.tier,
    [targetConfig.updatedAtField]: admin.firestore.FieldValue.serverTimestamp(),
  }
  if (target === 'pulseCheck') {
    update.pulseCheckEnabled = true
  }
  await companyRef.update(update)

  await writeAuditEntry(firestore, companyId, {
    action: targetConfig.historyAction,
    changedByUid: uid,
    changedByRole: role,
    fromTier: previousTier,
    toTier: band.tier,
    employeeCountAtChange: employeeCount,
    ...(target === 'pulseCheck' ? { enabled: true } : {}),
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'upgrade_subscription',
    outcome: 'granted',
    detail: `${target}:${previousTier ?? 'none'}->${band.tier}`,
  })

  return { target, tier: band.tier, ...(target === 'pulseCheck' ? { enabled: true } : {}) }
})
