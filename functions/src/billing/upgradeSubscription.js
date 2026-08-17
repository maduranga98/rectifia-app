const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  PROGRESSIVE_THRESHOLD_EMPLOYEES,
  PUBLISHED_BANDS,
  PULSE_CHECK_BANDS,
  calculateMonthlyPrice,
  calculatePulseCheckAddOnPrice,
  readDeclaredEmployeeCount,
} = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { startCheckoutForCompany, pulseCheckPriceData } = require('./createCheckoutSession')

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

// Updates the Core item's price on an EXISTING Stripe subscription to match
// `band`. Mirrors syncSubscriptionPricing.js's syncCoreItem, with one
// deliberate difference: proration_behavior is left at Stripe's default
// (create_prorations) rather than syncCoreItem's explicit 'none', because
// this is a discrete action a Company Admin just took, not a background
// drift correction - same distinction togglePulseCheckAddOn.js's own
// item-create call documents for its default proration.
async function updateCoreItemPrice(stripe, company, band, quote) {
  const item = await stripe.subscriptionItems.retrieve(company.stripeCoreItemId, {
    expand: ['price.product'],
  })
  const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id

  if (company.subscriptionTier !== band.tier) {
    await stripe.products.update(productId, { name: `Rectifia - ${band.label} plan` })
  }

  await stripe.subscriptionItems.update(company.stripeCoreItemId, {
    price_data: {
      currency: 'usd',
      product: productId,
      unit_amount: Math.round(quote.monthlyPrice * 100),
      recurring: { interval: 'month' },
    },
  })
}

// Creates or repriced the Pulse Check item on an EXISTING Stripe
// subscription. Same default-proration reasoning as updateCoreItemPrice
// above, and the same price - calculatePulseCheckAddOnPrice(), the published
// PULSE_CHECK_BANDS lookup - togglePulseCheckAddOn.js and
// syncSubscriptionPricing.js already use, so a Pulse Check band selected
// here is never priced differently from one toggled on elsewhere.
async function upsertPulseCheckItem(stripe, companyRef, company, addOnPrice) {
  if (company.stripePulseCheckItemId) {
    await stripe.subscriptionItems.update(company.stripePulseCheckItemId, {
      price_data: pulseCheckPriceData(addOnPrice),
    })
    return
  }

  const item = await stripe.subscriptionItems.create({
    subscription: company.stripeSubscriptionId,
    price_data: pulseCheckPriceData(addOnPrice),
    quantity: 1,
  })
  await companyRef.update({ stripePulseCheckItemId: item.id, 'featureFlags.pulseCheck': true })
}

// Instant(-feeling), self-serve Core-plan or Pulse Check band change for a
// company at or below the 500-employee self-serve threshold. Company Admin
// only - this spends the company's money, which is stricter than the
// view-only billingView permission module togglePulseCheckAddOn.js's own
// comment discusses for the read-only quote.
//
// Actually touches Stripe (unlike the earlier version of this callable,
// which only wrote Firestore fields): a brand-new company's first tier
// selection reuses createCheckoutSession.js's Checkout flow so a payment
// method gets collected (there is nothing to attach a subscriptionItem to
// otherwise); a later tier change on an existing subscription updates that
// item's price_data directly, same pattern togglePulseCheckAddOn.js already
// uses for its own item writes, with the same default (create_prorations)
// proration behavior - no custom proration rule is invented here.
//
// The Firestore tier fields (subscriptionTier/pulseCheckTier) are written
// immediately regardless of which Stripe path ran. For the first-Core-
// selection Checkout path this is necessarily optimistic: Checkout Sessions
// aren't synchronous, so if a Company Admin starts Checkout and never
// completes it, the tier field reflects what they selected, not a confirmed
// charge, until they either finish Checkout or pick again. That mirrors this
// callable's pre-existing "self-declared, not automatically reconciled"
// posture (see pricingEngine.js's readDeclaredEmployeeCount() comment) and
// is an accepted v1 tradeoff, not silently different behavior for this one
// case.
exports.upgradeSubscription = onCall({ secrets: [stripeSecretKey] }, async (request) => {
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
  const stripe = getStripeClient()

  if (disablingPulseCheck) {
    if (company.stripePulseCheckItemId) {
      // clear_usage isn't relevant (this is a licensed, not metered, item);
      // Stripe prorates the cancellation credit by default, same as
      // togglePulseCheckAddOn.js's own disable path.
      await stripe.subscriptionItems.del(company.stripePulseCheckItemId)
      await companyRef.update({
        stripePulseCheckItemId: admin.firestore.FieldValue.delete(),
        'featureFlags.pulseCheck': false,
        pulseCheckEnabled: false,
        pulseCheckTier: null,
        pulseCheckUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    } else {
      await companyRef.update({
        pulseCheckEnabled: false,
        pulseCheckTier: null,
        pulseCheckUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }

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

  let checkoutUrl = null

  if (target === 'core') {
    if (!company.stripeSubscriptionId) {
      const { url } = await startCheckoutForCompany(firestore, stripe, companyId, company, {
        includePulseCheck: false,
      })
      checkoutUrl = url
    } else {
      if (!company.stripeCoreItemId) {
        throw new HttpsError(
          'failed-precondition',
          'No active Core plan item found on your subscription - contact support'
        )
      }
      const quote = calculateMonthlyPrice(employeeCount)
      await updateCoreItemPrice(stripe, company, band, quote)
      await companyRef.update({
        stripeLastSyncedCoreAmountCents: Math.round(quote.monthlyPrice * 100),
        stripeLastSyncedTier: band.tier,
      })
    }
  } else {
    if (!company.stripeSubscriptionId) {
      throw new HttpsError('failed-precondition', 'Set up your Core plan before adding Pulse Check')
    }
    const addOnPrice = calculatePulseCheckAddOnPrice(employeeCount)
    await upsertPulseCheckItem(stripe, companyRef, company, addOnPrice)
    await companyRef.update({ stripeLastSyncedPulseCheckAmountCents: Math.round(addOnPrice * 100) })
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
    ...(checkoutUrl ? { viaCheckout: true } : {}),
  })

  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'upgrade_subscription',
    outcome: 'granted',
    detail: `${target}:${previousTier ?? 'none'}->${band.tier}`,
  })

  return {
    target,
    tier: band.tier,
    ...(target === 'pulseCheck' ? { enabled: true } : {}),
    ...(checkoutUrl ? { checkoutUrl } : {}),
  }
})
