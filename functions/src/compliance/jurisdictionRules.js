// Jurisdiction-specific compliance rule sets (module 11). Adding a new
// jurisdiction means adding an entry here - scheduleDeadlines.js and
// checkOverdueDeadlines.js never branch on a jurisdiction code themselves,
// they only ever read whatever getStrictestRule() returns.
//
// EU's numbers come from the EU Whistleblower Protection Directive
// (2019/1937): acknowledge receipt within 7 days, give the reporter
// feedback within 3 months (approximated here as 90 days). Jurisdictions
// with no comparable statutory deadline fall back to a longer company-policy
// default rather than being left unregulated.
const JURISDICTION_RULES = {
  EU: {
    label: 'EU Whistleblower Protection Directive (2019/1937)',
    acknowledgmentDueDays: 7,
    feedbackDueDays: 90,
  },
  UK: {
    label: 'UK company policy default (PIDA sets no statutory deadline)',
    acknowledgmentDueDays: 30,
    feedbackDueDays: 90,
  },
  US: {
    label: 'US company policy default (no uniform federal deadline)',
    acknowledgmentDueDays: 30,
    feedbackDueDays: 90,
  },
  LK: {
    label: 'LK company policy default',
    acknowledgmentDueDays: 30,
    feedbackDueDays: 90,
  },
}

// Used when a company has no configured jurisdictions, or none of them are
// in JURISDICTION_RULES yet - a case never goes untracked for lack of a
// matching rule.
const FALLBACK_RULE = {
  label: 'Fallback company policy default (no matching jurisdiction rule)',
  acknowledgmentDueDays: 30,
  feedbackDueDays: 90,
}

function getRuleForJurisdiction(jurisdiction) {
  return JURISDICTION_RULES[jurisdiction] ?? null
}

// A company can select multiple jurisdictions (companyService.js). The
// applicable rule is whichever configured jurisdiction has the shortest
// acknowledgment window, ties broken by the shortest feedback window -
// i.e. the strictest rule always wins, never just the first one listed.
function getStrictestRule(jurisdictions = []) {
  const rules = jurisdictions.map(getRuleForJurisdiction).filter(Boolean)
  if (rules.length === 0) return FALLBACK_RULE

  return rules.reduce((strictest, rule) => {
    if (rule.acknowledgmentDueDays < strictest.acknowledgmentDueDays) return rule
    if (rule.acknowledgmentDueDays > strictest.acknowledgmentDueDays) return strictest
    return rule.feedbackDueDays < strictest.feedbackDueDays ? rule : strictest
  })
}

module.exports = { JURISDICTION_RULES, FALLBACK_RULE, getRuleForJurisdiction, getStrictestRule }
