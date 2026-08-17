const { onSchedule } = require('firebase-functions/v2/scheduler')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { shouldRunForCompany } = require('../utils/companySchedule')
const { calculateMonthlyPrice, calculatePulseCheckAddOnPrice, readDeclaredEmployeeCount } = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// A quiet maintenance hour, distinct from schedulePulseChecks.js's 9am (a
// wellness survey should arrive in the morning) and deliberately not
// midnight (still shows up as "yesterday" in some local displays) - 3am
// local is when a subscription's price silently changing is least likely to
// coincide with anyone actively looking at an invoice.
const TARGET_LOCAL_HOUR = 3

function centsFromDollars(amount) {
  return Math.round(amount * 100)
}

function titleCase(tier) {
  return tier ? `${tier[0].toUpperCase()}${tier.slice(1)}` : tier
}

// Keeps a company's Stripe subscription item price in sync with what
// pricingEngine.js's calculateMonthlyPrice() would quote for the declared
// headcount *today* - the same formula BillingQuote.jsx shows and
// createCheckoutSession.js charged at signup. Declared headcount
// (company.employeeCount) can drift from what was billed at signup or last
// sync - a Company Admin edits it via PackageSelector.jsx/upgradeSubscription
// .js any time, not just at tier-change moments - so the amount Stripe
// should charge next period has to move with it; nothing else in this
// codebase keeps that number current after the initial Checkout or the last
// self-serve tier change.
//
// proration_behavior: 'none' on every update here is deliberate and matches
// BillingQuote.jsx's whatIfCard footnote ("no cliffs, no surprise invoice"):
// this job changes what is charged starting the *next* billing cycle, never
// creates an immediate prorated charge or credit for a price change that
// merely reflects headcount drift since yesterday. (Contrast
// togglePulseCheckAddOn.js, which prorates on purpose - that is a discrete
// purchase/cancellation action a Company Admin just took, not a background
// drift.)
async function syncCoreItem(stripe, companyRef, company, quote) {
  const newAmountCents = centsFromDollars(quote.monthlyPrice)
  const priceUnchanged = company.stripeLastSyncedCoreAmountCents === newAmountCents
  const tierUnchanged = company.stripeLastSyncedTier === quote.tier
  if (priceUnchanged && tierUnchanged) return

  if (!company.stripeCoreItemId) {
    logger.warn('syncSubscriptionPricing: company has a subscription but no stripeCoreItemId', {
      companyId: companyRef.id,
    })
    return
  }

  const item = await stripe.subscriptionItems.retrieve(company.stripeCoreItemId, {
    expand: ['price.product'],
  })
  const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id

  if (!tierUnchanged) {
    await stripe.products.update(productId, { name: `Rectifia - ${titleCase(quote.tier)} plan` })
  }

  await stripe.subscriptionItems.update(company.stripeCoreItemId, {
    price_data: {
      currency: 'usd',
      product: productId,
      unit_amount: newAmountCents,
      recurring: { interval: 'month' },
    },
    proration_behavior: 'none',
  })

  await companyRef.update({
    stripeLastSyncedCoreAmountCents: newAmountCents,
    stripeLastSyncedTier: quote.tier,
  })
}

async function syncPulseCheckItem(stripe, companyRef, company, employeeCount) {
  if (!company.stripePulseCheckItemId) return

  const newAmountCents = centsFromDollars(calculatePulseCheckAddOnPrice(employeeCount))
  if (company.stripeLastSyncedPulseCheckAmountCents === newAmountCents) return

  const item = await stripe.subscriptionItems.retrieve(company.stripePulseCheckItemId, {
    expand: ['price.product'],
  })
  const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id

  await stripe.subscriptionItems.update(company.stripePulseCheckItemId, {
    price_data: {
      currency: 'usd',
      product: productId,
      unit_amount: newAmountCents,
      recurring: { interval: 'month' },
    },
    proration_behavior: 'none',
  })

  await companyRef.update({ stripeLastSyncedPulseCheckAmountCents: newAmountCents })
}

exports.syncSubscriptionPricing = onSchedule({ schedule: 'every 1 hours', secrets: [stripeSecretKey] }, async () => {
  const firestore = admin.firestore()
  const stripe = getStripeClient()
  const now = new Date()

  const companiesSnapshot = await firestore
    .collection(COMPANIES_COLLECTION)
    .where('stripeSubscriptionId', '!=', null)
    .get()

  for (const companyDoc of companiesSnapshot.docs) {
    const company = companyDoc.data()
    if (!shouldRunForCompany(company, TARGET_LOCAL_HOUR, now)) continue

    try {
      const employeeCount = readDeclaredEmployeeCount(company)
      if (employeeCount === null) continue

      const quote = calculateMonthlyPrice(employeeCount)
      await syncCoreItem(stripe, companyDoc.ref, company, quote)
      await syncPulseCheckItem(stripe, companyDoc.ref, company, employeeCount)
    } catch (err) {
      // One company's Stripe API error (a canceled card on file, a deleted
      // item, a transient network error) must never stop the sweep from
      // reaching every other company - same isolation as
      // schedulePulseChecks.js's per-company try/catch.
      logger.error('syncSubscriptionPricing: failed for company', {
        companyId: companyDoc.id,
        message: err.message,
      })
    }
  }
})
