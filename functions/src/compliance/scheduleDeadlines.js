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

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

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

  // Deadlines run from when the report reached the company, not from when
  // its case document happened to be created. For a reporter filing their
  // own report the two are the same instant (submitCase.js writes both), but
  // a staff member typing up a call from last month
  // (createCaseOnBehalf.js) creates the document long after the clock
  // started. Computing from createdAt there would silently hand the company
  // a fresh full window on a report that is already weeks old - a compliance
  // deadline that resets itself whenever someone gets around to data entry
  // is not a deadline.
  //
  // A case with no reportedAt predates the field; falling back to now
  // reproduces the old behaviour exactly for those, which is right, because
  // for every case written before this field existed reportedAt and
  // createdAt genuinely were the same moment.
  const reportedAtMs = toMillis(caseData.reportedAt) ?? Date.now()
  const acknowledgmentDueAt = admin.firestore.Timestamp.fromMillis(reportedAtMs + rule.acknowledgmentDueDays * DAY_MS)
  const feedbackDueAt = admin.firestore.Timestamp.fromMillis(reportedAtMs + rule.feedbackDueDays * DAY_MS)

  // A backdated entry can land with its acknowledgment window already spent.
  // That is a true statement about the case, not an error to paper over, so
  // the deadline is written as-is and the fact is logged - checkOverdueDeadlines.js
  // will treat it like any other missed deadline, which is the point.
  if (acknowledgmentDueAt.toMillis() < Date.now()) {
    logger.warn('scheduleDeadlines: acknowledgment window already elapsed when case was entered', {
      caseId,
      source: caseData.source ?? 'reporter',
      reportedAtMs,
    })
  }

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
