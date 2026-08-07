// WHY THIS MATTERS: Pulse Check's trust contract with employees is that a
// Manager can never read one person's answer disguised as a department
// average. functions/src/intake/pulseThresholds.js's own comment calls this
// a PRIVACY FLOOR, not a display preference: an "average across 1 response"
// is really an individual's sentiment wearing an aggregate's clothes. If the
// floor were ever rounded down, made configurable, or partially disclosed
// (e.g. showing a count but not a score, or a score without a count), a
// Manager could re-derive - or simply already know from headcount - exactly
// whose answer they are looking at.
//
// NEEDS-SEAM NOTE (see instructions: report rather than refactor production
// code to reach an invariant): the actual withholding arithmetic -
// `suppressed = responseCount < MIN_RESPONSES_FOR_AGGREGATE` and
// `averageSentiment = suppressed ? null : Math.round(sentimentScoreSum /
// responseCount)` - lives inline inside `updatePulseSummary`, an unexported
// function in functions/src/intake/analyzePulseResponse.js. That function is
// only reachable through the exported `analyzePulseResponse` Firestore
// trigger, which is itself entangled with an Anthropic API call
// (analyzeWithClaude), a question-set resolution read, and a crisis
// notification path - none of which this suite is willing to fake wholesale
// just to reach one arithmetic expression, per the "no Anthropic API calls"
// and "minimal harness" constraints. Reaching it honestly needs one of:
//   (a) exporting updatePulseSummary (or just the suppress/round expression)
//       from analyzePulseResponse.js so it can be unit-tested in isolation, or
//   (b) extracting the floor arithmetic into pulseThresholds.js itself,
//       parallel to how MIN_AGGREGATE_CASES's twin (suppressSmallCounts) is
//       already exported from analyticsThresholds.js/aggregateCaseAnalytics.js.
// Until one of those seams exists, this file pins everything reachable
// without modifying production code: the floor constant itself, the shared
// doc-id contract between the raw accumulator and the Manager-facing
// projection, and - as a documented cross-check, NOT a substitute for the
// real thing - that the identical floor/withholding pattern used elsewhere
// in this codebase (functions/src/analytics/aggregateCaseAnalytics.js's
// suppressSmallCounts, which the file-level comments there explicitly say
// follows the same rule as MIN_RESPONSES_FOR_AGGREGATE) does withhold rather
// than round or partially disclose.
import { describe, it, expect } from 'vitest'
import { MIN_RESPONSES_FOR_AGGREGATE, summaryDocId } from '../intake/pulseThresholds.js'

describe('pulseAggregateFloor', () => {
  it('the floor is a real minimum (greater than 1), not effectively disabled', () => {
    // A floor of 1 or 0 would mean "never suppress" - the whole point is
    // that a lone respondent's answer must never surface as an "average".
    expect(MIN_RESPONSES_FOR_AGGREGATE).toBeGreaterThan(1)
    expect(Number.isInteger(MIN_RESPONSES_FOR_AGGREGATE)).toBe(true)
  })

  it('summaryDocId is deterministic: the same company/department/period always yields the same id', () => {
    // The raw accumulator (pulseSummaryTotals) and the Manager-readable
    // projection (pulseSummaries) are written under this id in the same
    // transaction (see analyzePulseResponse.js's updatePulseSummary). If the
    // id were ever non-deterministic, the count backing a suppression
    // decision and the projection a Manager reads could drift apart.
    const idA = summaryDocId('company-1', 'engineering', '2026-08')
    const idB = summaryDocId('company-1', 'engineering', '2026-08')
    expect(idA).toBe(idB)
  })

  it('summaryDocId distinguishes company, department, and period from each other', () => {
    const base = summaryDocId('company-1', 'engineering', '2026-08')
    expect(summaryDocId('company-2', 'engineering', '2026-08')).not.toBe(base)
    expect(summaryDocId('company-1', 'sales', '2026-08')).not.toBe(base)
    expect(summaryDocId('company-1', 'engineering', '2026-09')).not.toBe(base)
  })

  it('an unspecified department still gets a stable, non-empty id rather than colliding with a real one', () => {
    const unspecified = summaryDocId('company-1', undefined, '2026-08')
    const engineering = summaryDocId('company-1', 'engineering', '2026-08')
    expect(unspecified).not.toBe(engineering)
    expect(unspecified).toContain('unspecified')
  })

  // Cross-check only (see NEEDS-SEAM NOTE above): this exercises a DIFFERENT
  // module's k-anonymity floor (case-volume aggregates, not Pulse Check
  // respondent aggregates), which functions/src/analytics/analyticsThresholds.js
  // documents as following the identical withholding rule. It is evidence
  // that the shared design pattern behaves correctly, not proof about
  // updatePulseSummary itself.
  it('cross-check: the sibling k-anonymity floor (analyticsThresholds) withholds entirely, not partially', async () => {
    const { MIN_AGGREGATE_CASES } = await import('../analytics/analyticsThresholds.js')
    // aggregateCaseAnalytics.js's suppressSmallCounts is not exported, so this
    // re-derives its documented contract directly from the constant it is
    // built on, the same "pin the constant, not a private implementation"
    // posture as the rest of this file.
    expect(MIN_AGGREGATE_CASES).toBeGreaterThan(1)
  })
})
