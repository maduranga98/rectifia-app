// The k-anonymity privacy floor for this module's aggregates, the same
// pattern MIN_RESPONSES_FOR_AGGREGATE (functions/src/intake/pulseThresholds.js)
// and MIN_REFERENCE_CASES (functions/src/consistency/checkConsistency.js)
// already apply to Pulse Check and the Consistency Engine respectively. A
// department/category breakdown below this many cases is withheld entirely
// rather than shown thin - a count of 1 or 2 dressed up as a "breakdown" is
// really one case's outcome wearing an aggregate's clothes, which is exactly
// what would let a low-volume department be re-identified from a chart.
//
// Deliberately hard-coded, not company-configurable, for the same reason
// MIN_RESPONSES_FOR_AGGREGATE is: a Company Admin able to lower it would
// defeat the guarantee this dashboard is sold on.
const MIN_AGGREGATE_CASES = 5

// How many trailing monthly periods aggregateCaseAnalytics.js keeps trend
// documents for. A rolling window, not "since the beginning of time" - old
// periods are pruned on each run so the analytics subcollection doesn't grow
// without bound, and a year of monthly trend points is enough for every
// chart AnalyticsDashboard.jsx draws.
const TREND_WINDOW_MONTHS = 12

// Severity/evidence scores are 0-100 (see functions/src/intake/scoreCase.js);
// bucketing into five bands is what makes a "distribution over time" chart
// aggregate rather than a scatter of individual scores that could be lined
// up against a known case.
const SCORE_BUCKETS = [
  { id: '0-20', min: 0, max: 20 },
  { id: '21-40', min: 21, max: 40 },
  { id: '41-60', min: 41, max: 60 },
  { id: '61-80', min: 61, max: 80 },
  { id: '81-100', min: 81, max: 100 },
]

function bucketForScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return null
  return SCORE_BUCKETS.find((bucket) => score >= bucket.min && score <= bucket.max)?.id ?? null
}

module.exports = { MIN_AGGREGATE_CASES, TREND_WINDOW_MONTHS, SCORE_BUCKETS, bucketForScore }
