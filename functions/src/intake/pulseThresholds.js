// The k-anonymity privacy floor for Manager / Company Admin-facing pulse
// aggregates. A department/period average is withheld from those roles until
// at least this many people have responded. This is a PRIVACY FLOOR, not a
// display preference: below it an "average across 1 response" is really an
// individual's sentiment wearing an aggregate's clothes - individual
// attribution wearing an aggregate label - which is exactly what the Pulse
// Check trust contract promises can never reach a manager.
//
// It is deliberately hard-coded and never made company-configurable: a Company
// Admin able to lower it to 1 would defeat the entire guarantee the module is
// sold on. It never applies to HR Coordinator / Pulse Check Reviewer, who read
// every aggregate (and every individual response) unconditionally.
const MIN_RESPONSES_FOR_AGGREGATE = 5

// The deterministic doc id shared by pulseSummaryTotals/{id} (the raw
// accumulator, Admin SDK only) and pulseSummaries/{id} (the Manager-readable
// projection), so the two are written together under one id in one transaction.
function summaryDocId(companyId, department, period) {
  return `${companyId}__${department || 'unspecified'}__${period}`
}

module.exports = { MIN_RESPONSES_FOR_AGGREGATE, summaryDocId }
