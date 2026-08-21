const { onDocumentUpdated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { PROGRESSIVE_THRESHOLD_EMPLOYEES } = require('./pricingEngine')
const { stripeSecretKey, getStripeClient } = require('./stripeClient')
const { generateAndFileQuote } = require('./requestQuote')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const QUOTE_REQUESTS_COLLECTION = 'quoteRequests'

// Auto-fires the same real, draft Stripe Quote requestQuote.js's Company
// Admin button files, the moment a company's real Pulse Check roster
// (companies/{companyId}.currentEmployeeCount, maintained transactionally
// by addEmployee.js/removeEmployee.js/bulkAddEmployees.js) crosses above
// PROGRESSIVE_THRESHOLD_EMPLOYEES - past the point where the flat published
// bands even apply. Fires on the crossing itself, never on every
// subsequent roster edit: `before <= threshold && after > threshold` is a
// one-time edge check, not a level check, so a company sitting above the
// threshold that adds or removes more employees is not re-quoted, and a
// company that dips back below and crosses again is (deliberately) treated
// as a fresh crossing. Skipped outright once the company already has a
// live subscription (stripeSubscriptionId) or an existing quoteRequests
// doc, manual or auto-generated - growth past that point is Lumora's
// ongoing conversation with them, not a new automated event. Same
// draft-only Stripe behavior as the manual path: this never finalizes or
// sends the Quote, no customer-facing state changes here at all.
exports.autoGenerateQuoteOnGrowth = onDocumentUpdated(
  { document: `${COMPANIES_COLLECTION}/{companyId}`, secrets: [stripeSecretKey] },
  async (event) => {
    const before = event.data.before.data()
    const after = event.data.after.data()
    const companyId = event.params.companyId

    const beforeCount = Number(before?.currentEmployeeCount)
    const afterCount = Number(after?.currentEmployeeCount)
    const justCrossed =
      Number.isFinite(afterCount) &&
      afterCount > PROGRESSIVE_THRESHOLD_EMPLOYEES &&
      Number.isFinite(beforeCount) &&
      beforeCount <= PROGRESSIVE_THRESHOLD_EMPLOYEES
    if (!justCrossed) return

    if (after.stripeSubscriptionId) return

    const firestore = admin.firestore()
    const quoteRequestSnapshot = await firestore.collection(QUOTE_REQUESTS_COLLECTION).doc(companyId).get()
    if (quoteRequestSnapshot.exists) return

    const stripe = getStripeClient()
    try {
      await generateAndFileQuote(firestore, stripe, {
        companyId,
        company: after,
        targets: ['core', 'pulseCheck'],
        triggeredBy: 'system',
      })
    } catch (err) {
      logger.error('autoGenerateQuoteOnGrowth: failed to generate quote', {
        companyId,
        error: err.message,
      })
    }
  }
)
