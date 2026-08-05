const { validateCaseAccess } = require('./src/intake/generateCaseAccess')
const { submitCase } = require('./src/intake/submitCase')
const { createCaseOnBehalf } = require('./src/intake/createCaseOnBehalf')
const { scoreCase } = require('./src/intake/scoreCase')
const { routeCase, reassignCase } = require('./src/intake/routeCase')
const { getCaseThread, postReporterMessage, postInvestigatorMessage } = require('./src/intake/caseThread')
const {
  requestEvidenceUploadUrl,
  requestEvidenceDownloadUrl,
} = require('./src/intake/evidenceAccess')
const {
  upgradeToConfidential,
  addContactEmail,
  removeContactEmail,
} = require('./src/intake/identityTransition')
const { aiFollowUp } = require('./src/intake/aiFollowUp')
const { generateChecklist, updateChecklistItem } = require('./src/intake/generateChecklist')
const { storeReferenceCase } = require('./src/consistency/storeReferenceCase')
const { checkConsistency } = require('./src/consistency/checkConsistency')
const { detectPatterns } = require('./src/patterns/detectPatterns')
const { generateReport } = require('./src/intake/generateReport')
const { exportReportPdf } = require('./src/reports/exportReportPdf')
const { scheduleDeadlines } = require('./src/compliance/scheduleDeadlines')
const { checkOverdueDeadlines } = require('./src/compliance/checkOverdueDeadlines')
const { proposeAction, closeCase, reviewConsistencyFlag } = require('./src/investigation/caseActions')
const { getCaseForTriage } = require('./src/investigation/getCaseForTriage')
const { revealIdentity } = require('./src/investigation/revealIdentity')
const { syncCaseMetadata } = require('./src/intake/syncCaseMetadata')
const { syncCompanyStats } = require('./src/company/syncCompanyStats')
const { inviteStaff } = require('./src/staff/inviteStaff')
const { createCompanyAdmin } = require('./src/company/createCompanyAdmin')
const { resolveCompanySlug } = require('./src/company/resolveCompanySlug')
const { acceptInvite } = require('./src/staff/acceptInvite')
const { updateStaffDepartments } = require('./src/staff/updateStaffDepartments')
const { submitPulseResponse, analyzePulseResponse } = require('./src/intake/analyzePulseResponse')
const { validatePulseInvite } = require('./src/intake/pulseInvites')
const { schedulePulseChecks } = require('./src/intake/schedulePulseChecks')
const { sendPulseChecksNow } = require('./src/intake/sendPulseChecksNow')
const {
  getPublishedQuestionSet,
  saveSupplementaryQuestions,
  publishQuestionSet,
} = require('./src/pulse/questionSet')
const { sendTestPulseInvite } = require('./src/pulse/testInvite')
const {
  registerPushSubscription,
  unregisterPushSubscription,
  sendCaseUpdate,
} = require('./src/notifications/sendCaseUpdate')
const { sendContactEmailUpdate } = require('./src/notifications/sendContactEmailUpdate')
const { deliverNotifications } = require('./src/notifications/deliverNotifications')
const { scheduleFollowUps } = require('./src/followup/scheduleFollowUps')
const { runFollowUps } = require('./src/followup/runFollowUps')
const { submitFollowUpResponse } = require('./src/followup/submitFollowUpResponse')
const { requestPolicyUploadUrl, requestPolicyDownloadUrl } = require('./src/policy/policyAccess')
const { ingestPolicyDocument } = require('./src/policy/ingestPolicyDocument')
const { tagPolicyChunks } = require('./src/policy/tagPolicyChunks')
const {
  archivePolicyDocument,
  restorePolicyDocument,
  deletePolicyDocument,
} = require('./src/policy/managePolicyDocument')
const { applyRetention } = require('./src/retention/applyRetention')
const { setLegalHold, releaseLegalHold, listLegalHolds } = require('./src/retention/legalHold')
const {
  requestCaseDeletion,
  approveDeletionRequest,
  declineDeletionRequest,
} = require('./src/retention/deletionRequest')
const { previewRetention } = require('./src/retention/previewRetention')

exports.submitCase = submitCase
exports.createCaseOnBehalf = createCaseOnBehalf
exports.validateCaseAccess = validateCaseAccess
exports.scoreCase = scoreCase
exports.routeCase = routeCase
exports.reassignCase = reassignCase
exports.getCaseThread = getCaseThread
exports.postReporterMessage = postReporterMessage
exports.postInvestigatorMessage = postInvestigatorMessage
// Blueprint §7.2 / §8. Reporter-initiated only - each is authenticated by Case
// ID + passcode and has no staff-callable counterpart, by design.
exports.upgradeToConfidential = upgradeToConfidential
exports.addContactEmail = addContactEmail
exports.removeContactEmail = removeContactEmail
exports.requestEvidenceUploadUrl = requestEvidenceUploadUrl
exports.requestEvidenceDownloadUrl = requestEvidenceDownloadUrl
exports.aiFollowUp = aiFollowUp
exports.generateChecklist = generateChecklist
exports.updateChecklistItem = updateChecklistItem
exports.storeReferenceCase = storeReferenceCase
exports.checkConsistency = checkConsistency
exports.detectPatterns = detectPatterns
exports.generateReport = generateReport
// Module 24: server-side PDF export of the same compiled report, rendered
// inside the Function (pdfkit, no headless browser) and handed back only as
// a 15-minute signed URL - see functions/src/reports/exportReportPdf.js.
exports.exportReportPdf = exportReportPdf
exports.scheduleDeadlines = scheduleDeadlines
exports.checkOverdueDeadlines = checkOverdueDeadlines
exports.proposeAction = proposeAction
exports.closeCase = closeCase
exports.reviewConsistencyFlag = reviewConsistencyFlag
exports.getCaseForTriage = getCaseForTriage
exports.revealIdentity = revealIdentity
exports.syncCaseMetadata = syncCaseMetadata
exports.syncCompanyStats = syncCompanyStats
exports.inviteStaff = inviteStaff
exports.createCompanyAdmin = createCompanyAdmin
exports.resolveCompanySlug = resolveCompanySlug
exports.acceptInvite = acceptInvite
exports.updateStaffDepartments = updateStaffDepartments
exports.submitPulseResponse = submitPulseResponse
exports.validatePulseInvite = validatePulseInvite
exports.analyzePulseResponse = analyzePulseResponse
exports.schedulePulseChecks = schedulePulseChecks
exports.sendPulseChecksNow = sendPulseChecksNow
// Module 21. The questionnaire is a versioned, server-owned artifact: the core
// set is code (src/pulse/coreQuestions.js) and a company's supplementary
// questions are published as immutable versions, never edited in place.
exports.getPublishedQuestionSet = getPublishedQuestionSet
exports.saveSupplementaryQuestions = saveSupplementaryQuestions
exports.publishQuestionSet = publishQuestionSet
exports.sendTestPulseInvite = sendTestPulseInvite
exports.registerPushSubscription = registerPushSubscription
exports.unregisterPushSubscription = unregisterPushSubscription
exports.sendCaseUpdate = sendCaseUpdate
// The email half of the same update notification - same decoy template pool,
// same rotation, different transport.
exports.sendContactEmailUpdate = sendContactEmailUpdate
exports.deliverNotifications = deliverNotifications
exports.scheduleFollowUps = scheduleFollowUps
exports.runFollowUps = runFollowUps
exports.submitFollowUpResponse = submitFollowUpResponse
exports.requestPolicyUploadUrl = requestPolicyUploadUrl
exports.requestPolicyDownloadUrl = requestPolicyDownloadUrl
exports.ingestPolicyDocument = ingestPolicyDocument
exports.tagPolicyChunks = tagPolicyChunks
exports.archivePolicyDocument = archivePolicyDocument
exports.restorePolicyDocument = restorePolicyDocument
exports.deletePolicyDocument = deletePolicyDocument
// Module 23: Data Retention, Deletion & Legal Hold. applyRetention is the
// daily scheduled sweep; the rest are onCall - legal holds and the
// reporter-initiated erasure request are both human-decided actions on a
// case, and previewRetention is the companyAdmin-only dry run RetentionPage.jsx
// requires before a shortened window can be saved.
exports.applyRetention = applyRetention
exports.setLegalHold = setLegalHold
exports.releaseLegalHold = releaseLegalHold
exports.listLegalHolds = listLegalHolds
exports.requestCaseDeletion = requestCaseDeletion
exports.approveDeletionRequest = approveDeletionRequest
exports.declineDeletionRequest = declineDeletionRequest
exports.previewRetention = previewRetention
