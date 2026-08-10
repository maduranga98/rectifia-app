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
  // AU has no statutory response clock: Corporations Act Pt 9.4AAA and ASIC
  // RG 270 require a whistleblower policy that states its own timeframes,
  // but they don't impose the timeframes themselves. 30/90 is a
  // conservative company-policy default mirroring UK/US, not a statutory
  // figure. Pending employment-law review - this is an engineering default,
  // not legal advice.
  AU: {
    label:
      'AU company policy default (Corporations Act Pt 9.4AAA sets no statutory response deadline)',
    acknowledgmentDueDays: 30,
    feedbackDueDays: 90,
  },
  // JP's 20-day figure derives from the Whistleblower Protection Act's
  // external-disclosure protection trigger: a reporter who receives no
  // notice within 20 days of whether an investigation will be conducted
  // gains protected grounds for external disclosure. Tracking internally to
  // 20 days is therefore the defensible target, not a deadline the Act
  // directly imposes on the company. Pending employment-law review - this
  // is an engineering default, not legal advice.
  JP: {
    label: 'JP Whistleblower Protection Act (Act No. 122 of 2004, as amended 2022)',
    acknowledgmentDueDays: 20,
    feedbackDueDays: 90,
  },
  // Deprecated: LK is no longer offered for new company selection
  // (companyService.js SELECTABLE_JURISDICTIONS), but a company already
  // configured as LK must keep computing correct deadlines, so the rule
  // stays here indefinitely.
  LK: {
    label: 'LK company policy default',
    acknowledgmentDueDays: 30,
    feedbackDueDays: 90,
    deprecated: true,
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
