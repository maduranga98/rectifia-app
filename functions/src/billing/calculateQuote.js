const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { resolveStaffEffectivePermissions, hasPermission } = require('../utils/permissionResolver')
const { calculateMonthlyPrice, calculatePulseCheckAddOnPrice, countActiveEmployees } = require('./pricingEngine')

if (!admin.apps.length) {
  admin.initializeApp()
}

// Company Admin's billing quote, computed server-side from the company's
// real roster so the number this returns always matches what would be
// invoiced - the client-side pricingCalculator.js copy is for instant what-if
// UI feedback only and is never the source of truth for an actual bill.
// Company Admin only, and only for their own company: companyId in the
// request is verified against the caller's own custom claim rather than
// trusted outright, the same pattern functions/src/retention/previewRetention.js
// uses.
//
// This does not implement payment processing or invoicing itself - it
// returns a price number and a breakdown for display only. Actual Stripe
// checkout, subscription creation, and webhook-driven billingStatus sync
// live alongside this in createCheckoutSession.js, togglePulseCheckAddOn.js,
// createBillingPortalSession.js, stripeWebhook.js, and
// syncSubscriptionPricing.js - all of which share this same pricing formula
// via pricingEngine.js rather than recomputing it.
exports.calculateQuote = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { companyId } = request.data || {}

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }
  const tokenCompanyId = request.auth?.token?.companyId
  if (!tokenCompanyId || tokenCompanyId !== companyId) {
    throw new HttpsError('permission-denied', 'You may only view billing for your own company')
  }

  const firestore = admin.firestore()
  const role = await loadCallerRole(firestore, companyId, uid, 'calculate_quote')
  // Company Admin always may; a custom-role holder needs the billingView
  // permission module specifically (view-only, matching this callable's own
  // "no payment processing, display only" scope) - resolved fresh from the
  // customRoles doc, never a cached claim, same as every other composable
  // permission check in this module.
  const resolved = role === 'companyAdmin' ? null : await resolveStaffEffectivePermissions(firestore, companyId, uid)
  const authorized = role === 'companyAdmin' || hasPermission(resolved, 'billingView')
  if (!authorized) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'calculate_quote',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin may view billing for this company')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'calculate_quote', outcome: 'granted' })

  const employeeCount = await countActiveEmployees(firestore, companyId)
  if (employeeCount < 1) {
    return {
      employeeCount: 0,
      quote: null,
      pulseCheckAddOnPrice: 0,
    }
  }

  const quote = calculateMonthlyPrice(employeeCount)

  return {
    employeeCount,
    quote,
    pulseCheckAddOnPrice: calculatePulseCheckAddOnPrice(employeeCount),
  }
})
