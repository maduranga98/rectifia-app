const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const TRIAL_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

// Fires once, when a company doc is first created. Starts the 7-day trial
// clock from the document's own createdAt - never a client-supplied date, so
// a company can't extend its own trial by writing a future trialEndsAt (that
// field is sealed against client writes entirely, see firestore.rules'
// superAdminBillingFieldsLocked()). A company that predates this trigger
// never gets these fields backfilled - see checkTrialExpirations.js, which
// only ever acts on companies that HAVE a trialEndsAt.
exports.scheduleTrialExpiration = onDocumentCreated(`${COMPANIES_COLLECTION}/{companyId}`, async (event) => {
  const snapshot = event.data
  if (!snapshot) return

  const company = snapshot.data()
  const createdAt = company.createdAt
  const createdAtMs = typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : Date.now()
  const trialEndsAtMs = createdAtMs + TRIAL_DAYS * DAY_MS

  await snapshot.ref.update({
    trialStartedAt: admin.firestore.Timestamp.fromMillis(createdAtMs),
    trialEndsAt: admin.firestore.Timestamp.fromMillis(trialEndsAtMs),
    accessBlocked: false,
  })
})
