const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const { resolveStaffEffectivePermissions, hasPermission } = require('../utils/permissionResolver')
const { calculateMonthlyPrice, calculatePulseCheckAddOnPrice, readDeclaredEmployeeCount } = require('./pricingEngine')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Company Admin's billing quote, computed server-side from the company's
// declared headcount (companies/{companyId}.employeeCount - see
// pricingEngine.js's readDeclaredEmployeeCount() for why this, not the live
// Pulse Check roster, is authoritative) so the number this returns always
// matches what would be invoiced - the client-side pricingCalculator.js copy
// is for instant what-if UI feedback only and is never the source of truth
// for an actual bill.
// Company Admin only, and only for their own company: companyId in the
// request is verified against the caller's own custom claim rather than
// trusted outright, the same pattern functions/src/retention/previewRetention.js
// uses.
//
// This does not implement payment processing or invoicing itself - it
// returns a REFERENCE price number and a breakdown for display only, always
// labeled as such in the UI (BillingQuote.jsx). Pilot v1 has no self-serve
// subscription creation: a real company's actual price is negotiated by
// sales (see requestQuote.js, the "Contact sales" path this reference quote
// feeds into) and the resulting subscription is set up by hand directly
// against Stripe. createBillingPortalSession.js and stripeWebhook.js are the
// only other billing callables left alongside this one - the portal for a
// customer to manage payment/invoices once a subscription exists, the
// webhook to keep billingStatus in sync with whatever was set up manually.
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

  const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnapshot.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const employeeCount = readDeclaredEmployeeCount(companySnapshot.data())
  if (employeeCount === null) {
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
