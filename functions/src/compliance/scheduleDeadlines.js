const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { getStrictestRule } = require('./jurisdictionRules')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const COMPANIES_COLLECTION = 'companies'
const MESSAGES_SUBCOLLECTION = 'messages'
const DAY_MS = 24 * 60 * 60 * 1000

// Deliberately generic - no category, severity, evidence, or anything else
// derived from the reporter's answers. This is what makes the message safe
// to send unconditionally, to every case, the instant it's created: it
// can't read as an assessment of the report, only as confirmation the
// report exists and is being handled.
const ACKNOWLEDGMENT_TEXT =
  'Your report has been received and logged. It will be reviewed in accordance with our reporting procedures. ' +
  'You do not need to take any further action right now - you can check back here for updates or add more ' +
  'information to this case at any time.'

// Fires once, when a case is first created. Reads the company's configured
// jurisdictions (module 3, companies/{companyId}.jurisdictions) and applies
// whichever rule is strictest among them - see jurisdictionRules.js. A
// missing companyId or an unconfigured jurisdiction never blocks this: it
// falls back to a conservative default rather than leaving the case with no
// tracked deadlines at all.
exports.scheduleDeadlines = onDocumentCreated(`${CASES_COLLECTION}/{caseId}`, async (event) => {
  const snapshot = event.data
  if (!snapshot) return

  const caseId = event.params.caseId
  const caseData = snapshot.data()
  const firestore = admin.firestore()

  let jurisdictions = []
  if (caseData.companyId) {
    const companySnapshot = await firestore.collection(COMPANIES_COLLECTION).doc(caseData.companyId).get()
    jurisdictions = companySnapshot.exists ? companySnapshot.data().jurisdictions ?? [] : []
  } else {
    logger.error('scheduleDeadlines: case has no companyId, applying fallback policy', { caseId })
  }

  const rule = getStrictestRule(jurisdictions)
  const createdAtMs = Date.now()
  const acknowledgmentDueAt = admin.firestore.Timestamp.fromMillis(createdAtMs + rule.acknowledgmentDueDays * DAY_MS)
  const feedbackDueAt = admin.firestore.Timestamp.fromMillis(createdAtMs + rule.feedbackDueDays * DAY_MS)

  await snapshot.ref.update({
    acknowledgmentDueAt,
    feedbackDueAt,
    complianceRuleApplied: rule.label,
    acknowledgmentSentAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Posting this message IS the acknowledgment. It happens synchronously
  // with case creation, well inside any rule's acknowledgment window
  // (shortest configured is 7 days), so this alone satisfies that deadline
  // structurally - no human action is required to meet it.
  await snapshot.ref.collection(MESSAGES_SUBCOLLECTION).add({
    sender: 'system',
    type: 'message',
    text: ACKNOWLEDGMENT_TEXT,
    attachments: [],
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  })
})
