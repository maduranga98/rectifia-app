const { validateCaseAccess } = require('./src/intake/generateCaseAccess')
const { submitCase } = require('./src/intake/submitCase')
const { createCaseOnBehalf } = require('./src/intake/createCaseOnBehalf')
const { scoreCase } = require('./src/intake/scoreCase')
const { routeCase, reassignCase, backfillCaseDepartments } = require('./src/intake/routeCase')
const {
  getCaseThread,
  getCaseThreadForHandler,
  postReporterMessage,
  postInvestigatorMessage,
} = require('./src/intake/caseThread')
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
const { translateMessage } = require('./src/intake/translateMessage')
const { generateChecklist, updateChecklistItem } = require('./src/intake/generateChecklist')
const { askInThread } = require('./src/intake/askInThread')
const { storeReferenceCase } = require('./src/consistency/storeReferenceCase')
const { checkConsistency } = require('./src/consistency/checkConsistency')
const { detectPatterns } = require('./src/patterns/detectPatterns')
const { detectBurnoutTrends } = require('./src/patterns/detectBurnoutTrends')
const { generateReport } = require('./src/intake/generateReport')
const { exportReportPdf } = require('./src/reports/exportReportPdf')
const { scheduleDeadlines } = require('./src/compliance/scheduleDeadlines')
const { checkOverdueDeadlines } = require('./src/compliance/checkOverdueDeadlines')
const {
  designateHandler,
  revokeHandlerDesignation,
  acknowledgeConfidentiality,
} = require('./src/compliance/designatedHandlers')
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
const { removeStaffMember } = require('./src/staff/removeStaffMember')
const { createCustomRole, updateCustomRole, deleteCustomRole, seedDefaultCustomRoles } = require('./src/roles/customRoles')
const { assignStaffRole } = require('./src/roles/assignStaffRole')
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
const { backfillPolicyTags } = require('./src/policy/backfillPolicyTags')
const { deduplicatePolicyChunks } = require('./src/policy/deduplicatePolicyChunks')
const { applyRetention } = require('./src/retention/applyRetention')
const { setLegalHold, releaseLegalHold, listLegalHolds } = require('./src/retention/legalHold')
const {
  requestCaseDeletion,
  approveDeletionRequest,
  declineDeletionRequest,
} = require('./src/retention/deletionRequest')
const { previewRetention } = require('./src/retention/previewRetention')
const { computeBenchmarks } = require('./src/benchmark/computeBenchmarks')
const {
  getBenchmarksForCompany,
  setBenchmarkOptIn,
  getBenchmarkCatalog,
} = require('./src/benchmark/benchmarkAccess')
const { calculateQuote } = require('./src/billing/calculateQuote')
const { createBillingPortalSession } = require('./src/billing/createBillingPortalSession')
const { getSubscriptionSummary } = require('./src/billing/getSubscriptionSummary')
const { stripeWebhook } = require('./src/billing/stripeWebhook')
const { requestQuote } = require('./src/billing/requestQuote')
const { linkCompanySubscription } = require('./src/billing/linkCompanySubscription')
const { createCheckoutSession } = require('./src/billing/createCheckoutSession')
const { updatePulseCheckSubscription } = require('./src/billing/updatePulseCheckSubscription')
const { upgradeSubscriptionTier } = require('./src/billing/upgradeSubscriptionTier')
const { updateDeclaredHeadcount } = require('./src/billing/updateDeclaredHeadcount')
const { addEmployee } = require('./src/roster/addEmployee')
const { removeEmployee } = require('./src/roster/removeEmployee')
const { bulkAddEmployees } = require('./src/roster/bulkAddEmployees')
const { backfillEmployeeCount } = require('./src/roster/backfillEmployeeCount')
const { accessReview, attestAccessReview, getAccessReviewForAttestation } = require('./src/security/accessReview')
const { keyRotationCheck, recordKeyRotation, rotateIdentityVaultKey } = require('./src/security/keyRotation')
const { anomalyDetection, reviewSecurityAlert } = require('./src/security/anomalyDetection')
const { integrityCheck } = require('./src/security/integrityCheck')
const { backupVerification, attestRestoreTest } = require('./src/security/backupVerification')
const { getSecurityDashboard } = require('./src/security/securityDashboard')
const { createExternalShare, listCaseShares } = require('./src/sharing/createShare')
const { getSharedCase } = require('./src/sharing/accessShare')
const { accessSharedEvidence } = require('./src/sharing/accessSharedEvidence')
const { revokeExternalShare } = require('./src/sharing/revokeShare')
const { expireShares } = require('./src/sharing/expireShares')
const { aggregateCaseAnalytics } = require('./src/analytics/aggregateCaseAnalytics')
const { exportComplianceReport } = require('./src/analytics/exportComplianceReport')

exports.submitCase = submitCase
exports.createCaseOnBehalf = createCaseOnBehalf
exports.validateCaseAccess = validateCaseAccess
exports.scoreCase = scoreCase
exports.routeCase = routeCase
exports.reassignCase = reassignCase
exports.backfillCaseDepartments = backfillCaseDepartments
exports.getCaseThread = getCaseThread
exports.getCaseThreadForHandler = getCaseThreadForHandler
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
exports.translateMessage = translateMessage
exports.generateChecklist = generateChecklist
exports.askInThread = askInThread
exports.updateChecklistItem = updateChecklistItem
exports.storeReferenceCase = storeReferenceCase
exports.checkConsistency = checkConsistency
exports.detectPatterns = detectPatterns
exports.detectBurnoutTrends = detectBurnoutTrends
exports.generateReport = generateReport
// Module 24: server-side PDF export of the same compiled report, rendered
// inside the Function (pdfkit, no headless browser) and handed back only as
// a 15-minute signed URL - see functions/src/reports/exportReportPdf.js.
exports.exportReportPdf = exportReportPdf
exports.scheduleDeadlines = scheduleDeadlines
exports.checkOverdueDeadlines = checkOverdueDeadlines
// JP's designated-handler (従事者) register. Metadata only - see
// functions/src/compliance/designatedHandlers.js for the field shape and the
// self-acknowledgment rule.
exports.designateHandler = designateHandler
exports.revokeHandlerDesignation = revokeHandlerDesignation
exports.acknowledgeConfidentiality = acknowledgeConfidentiality
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
exports.removeStaffMember = removeStaffMember
// Composable custom-role layer: Company Admin builds named roles from a
// fixed permission-module allowlist (src/config/permissionModules.js /
// functions/src/utils/permissionResolver.js) and assigns them to staff who
// are neither Case Handler nor HR Coordinator - both of those stay fixed,
// non-composable roles untouched by this layer.
exports.createCustomRole = createCustomRole
exports.updateCustomRole = updateCustomRole
exports.deleteCustomRole = deleteCustomRole
exports.assignStaffRole = assignStaffRole
exports.seedDefaultCustomRoles = seedDefaultCustomRoles
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
exports.backfillPolicyTags = backfillPolicyTags
exports.deduplicatePolicyChunks = deduplicatePolicyChunks
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
// Module 25: Cross-Company Benchmark Pool. computeBenchmarks is the monthly
// scheduled recompute over the currently-opted-in set - the pool is
// computed, not accumulated, so withdrawal takes effect completely on the
// next run. The two onCalls are read (any staff of an opted-in company sees
// only their own cell) and opt-in (companyAdmin, with an explicit
// acknowledgement flag). The catalog is a small read of the industries and
// bands the form needs.
exports.computeBenchmarks = computeBenchmarks
exports.getBenchmarksForCompany = getBenchmarksForCompany
exports.setBenchmarkOptIn = setBenchmarkOptIn
exports.getBenchmarkCatalog = getBenchmarkCatalog
// Company Admin's REFERENCE billing quote: a preview price computed
// server-side from Rectifia's published rates and the company's declared
// headcount, always shown in the UI as a reference only - not what the
// company is actually billed. See functions/src/billing/calculateQuote.js
// for the full rationale (pilot v1 has no self-serve subscription path;
// every real customer's price is negotiated and set up by hand).
exports.calculateQuote = calculateQuote
// Stripe integration: the Stripe-hosted billing portal for payment
// method/invoices/cancellation once a subscription already exists
// (createBillingPortalSession), and the webhook that keeps
// companies/{companyId}.billingStatus and .featureFlags.pulseCheck in sync
// with whatever Stripe subscription a human has set up for that company
// (stripeWebhook - register this function's URL in the Stripe Dashboard's
// webhook settings). Nothing in this codebase creates a Stripe subscription
// anymore - see stripeWebhook.js's file comment.
exports.createBillingPortalSession = createBillingPortalSession
exports.stripeWebhook = stripeWebhook
// A live read-only summary of what an active subscriber is actually
// charged, fetched straight from Stripe on every call (never cached in
// Firestore) so BillingQuote.jsx's ActiveSubscriptionSummary can show a
// real price instead of the reference-quote formula. See
// getSubscriptionSummary.js for why it never hands back a Stripe
// price/product ID or the underlying bracket/formula.
exports.getSubscriptionSummary = getSubscriptionSummary
// The only billing action a Company Admin can take beyond viewing the
// reference quote and managing an existing subscription: ask Rectifia for a
// real, negotiated price at their declared headcount. Computes the
// reference quote via pricingEngine.js, files a real Stripe Quote object
// (draft, never auto-sent) against the company's Stripe Customer, and
// records both in quoteRequests/{companyId} for Lumora's own sales
// follow-up - without ever handing the formula or per-employee rates back
// to the client. See functions/src/billing/pricingEngine.js's
// readDeclaredEmployeeCount() for which employee-count field is
// authoritative - companies/{companyId}.employeeCount, not the live Pulse
// Check roster.
exports.requestQuote = requestQuote
// Super Admin only: links (or re-links, to change plan / re-sync) a Stripe
// subscription a human already created - via an accepted Quote or set up
// directly in the Stripe Dashboard - to a company. Never creates a Stripe
// subscription itself. This is the only client-reachable path that can set
// companies/{companyId}.stripeSubscriptionId/billingStatus/subscriptionTier
// (alongside stripeWebhook.js reacting to Stripe) - see
// firestore.rules' superAdminBillingFieldsLocked() for why no other client
// write, including a direct Super Admin write, can touch these fields.
exports.linkCompanySubscription = linkCompanySubscription
// Self-serve billing for a company at or below the 500-employee self-serve
// ceiling with no negotiated deal: createCheckoutSession starts real Stripe
// Checkout (Core, optionally with Pulse Check, as one subscription);
// updatePulseCheckSubscription adds/removes the Pulse Check item on an
// existing subscription; upgradeSubscriptionTier is the explicit,
// Company-Admin-initiated Core tier change (never a side effect of adding an
// employee). All three price off the REAL roster headcount
// (companies/{companyId}/employees), never the self-declared
// company.employeeCount calculateQuote.js/requestQuote.js use, and all three
// refuse a company above the self-serve ceiling - that stays exclusively on
// the requestQuote.js -> linkCompanySubscription.js path. See
// functions/src/billing/createCheckoutSession.js for the full rationale.
exports.createCheckoutSession = createCheckoutSession
exports.updatePulseCheckSubscription = updatePulseCheckSubscription
exports.upgradeSubscriptionTier = upgradeSubscriptionTier
// The declared-count counterpart of upgradeSubscriptionTier.js: lets a
// company whose subscription is priced from a self-declared headcount
// (billingHeadcountSource === 'declared', set by createCheckoutSession.js)
// re-declare that number and move the Core tier up OR down to match - the
// only tier-movement path such a company has, since it never has a real
// roster to hit upgradeSubscriptionTier.js's cap check. Refuses outright for
// a roster-priced company. See updateDeclaredHeadcount.js.
exports.updateDeclaredHeadcount = updateDeclaredHeadcount
// The Pulse Check recipient roster's only remaining write path
// (companies/{companyId}/employees create/delete - firestore.rules now
// grants a Company Admin `update` there but not `create`/`delete`): each
// transactionally enforces the plan's headcount cap
// (companies/{companyId}.currentEmployeeCount vs. the PUBLISHED_BANDS entry
// for subscriptionTier) against the same counter it increments/decrements,
// so the cap can't be bypassed by two concurrent writes. backfillEmployeeCount
// is the one-time, Super-Admin-triggerable migration that seeds
// currentEmployeeCount for companies that predate this cap. See
// functions/src/roster/addEmployee.js for the full rationale.
exports.addEmployee = addEmployee
exports.removeEmployee = removeEmployee
exports.bulkAddEmployees = bulkAddEmployees
exports.backfillEmployeeCount = backfillEmployeeCount
// Module 26: Security Control & Evidence Layer. Five scheduled controls
// (accessReview quarterly, keyRotationCheck weekly, anomalyDetection daily,
// integrityCheck weekly, backupVerification monthly) plus the onCall
// counterparts a human uses to act on what they find: attesting a review,
// recording/executing a key rotation, reviewing an alert, attesting a
// restore test. None of these revoke access, delete data, or block a user -
// see the "advisory only" comment on each module. getSecurityDashboard is the
// one read path for src/pages/superadmin/SecurityDashboard.jsx, which has no
// direct Firestore access to any of this module's sealed collections.
exports.accessReview = accessReview
exports.attestAccessReview = attestAccessReview
exports.getAccessReviewForAttestation = getAccessReviewForAttestation
exports.keyRotationCheck = keyRotationCheck
exports.recordKeyRotation = recordKeyRotation
exports.rotateIdentityVaultKey = rotateIdentityVaultKey
exports.anomalyDetection = anomalyDetection
exports.reviewSecurityAlert = reviewSecurityAlert
exports.integrityCheck = integrityCheck
exports.backupVerification = backupVerification
exports.attestRestoreTest = attestRestoreTest
exports.getSecurityDashboard = getSecurityDashboard
// Module 27: External Advisor Share Links. createExternalShare/
// listCaseShares are the assigned Case Handler's own tools (Company Admin
// has no path to any of these three); getSharedCase is the sole
// unauthenticated entry point an external recipient ever reaches, built
// from scratch rather than on top of any reporter- or staff-authenticated
// path; revokeExternalShare is immediate and available to the assigned
// handler or a Super Admin; expireShares is the daily bookkeeping sweep.
exports.createExternalShare = createExternalShare
exports.listCaseShares = listCaseShares
exports.getSharedCase = getSharedCase
// Evidence-opening counterpart of getSharedCase - see the module comment in
// accessSharedEvidence.js for why it is its own callable rather than a
// parameter on getSharedCase.
exports.accessSharedEvidence = accessSharedEvidence
exports.revokeExternalShare = revokeExternalShare
exports.expireShares = expireShares
// Module 28: Analytics & Reporting Dashboard. aggregateCaseAnalytics is the
// daily scheduled recompute of companies/{companyId}/analytics/* from
// caseMetadata and referenceCases only - never cases/{caseId}, never
// messages/. exportComplianceReport compiles those same aggregates into a
// board/audit-ready PDF, read/compile only like Module 24's exportReportPdf.
exports.aggregateCaseAnalytics = aggregateCaseAnalytics
exports.exportComplianceReport = exportComplianceReport
