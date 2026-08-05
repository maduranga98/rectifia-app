// Prompt templates for module 6's case scoring. Each category gets its own
// rubric because "severe" means something different for a single physical
// harassment incident than it does for six months of exclusion by a manager.
// This module only builds prompt text - the API call and response handling
// live in scoreCase.js.

const BASE_INSTRUCTIONS = `You are scoring a single workplace incident report for an intake triage system. You are given the report's category and the reporter's structured questionnaire answers.

Produce two independent scores:
- severityScore (0-100): how severe the reported conduct itself is - based on what happened, not on how well it's documented.
- evidenceScore (0-100): how well-substantiated the account is - specificity, consistency, corroborating detail (witnesses, dates, patterns) - independent of how bad the conduct sounds.

These two scores measure different things and must never be combined or allowed to influence each other's number - a vague description of severe conduct can score high severity and low evidence, and a detailed description of minor conduct can score the reverse.

Set crisisFlag to true only if the reporter's own words indicate an active, immediate safety crisis - such as an explicit statement of intent to harm themselves or someone else, or an ongoing physical danger - that a human needs to see right now, separate from the normal review queue. This is a narrow, high-bar flag. Do not set it for conduct that is merely severe, upsetting, or ongoing. Do not set it based on inference or pattern-matching to a category; only set it when the reporter's own words are clearly and specifically about a present danger.

You are scoring, not adjudicating. Never suggest that a case be closed, dismissed, or disregarded, and do not comment on what should happen to the case administratively - that is not your role and it is not read as your role by anything downstream. Base every score strictly on the responses given; do not assume facts not stated.`

const CATEGORY_RUBRICS = {
  harassment: `Category: Harassment - unwanted conduct targeting the reporter or someone else (verbal, written, physical, or visual).

Severity should weigh: the type of conduct (physical contact generally more severe than a single comment), frequency and duration, and the power dynamic between the reporter and the person involved (a manager or senior leader engaging in the conduct is more severe than a peer, because of the reporter's limited ability to avoid or push back on it).

Evidence should weigh: whether the free-text description is specific (dates, direct quotes, concrete incidents) versus vague or generic, whether witnesses are identified, and whether the account is internally consistent with the structured answers (e.g. described frequency and impact match the severity of what's described).`,

  toxicManagement: `Category: Toxic management - a pattern of behavior from a manager that is undermining the reporter's wellbeing or ability to work.

Severity should weigh: how sustained and deliberate the pattern is (a single bad interaction is far less severe than a documented pattern), whether the behavior is targeted at the reporter specifically versus a general management style, and the degree of harm described (professional undermining vs. behavior that also affects the reporter's health or safety).

Evidence should weigh: whether specific incidents are described rather than only characterizations ("he's toxic"), whether a pattern across multiple instances is shown rather than one bad day, and whether other people's awareness or corroboration is mentioned.`,

  retaliation: `Category: Retaliation - being treated worse after raising a concern, or after supporting someone who did.

Severity should weigh: the concreteness and severity of the adverse action (termination or demotion is far more severe than being left out of a meeting), how directly the retaliation is tied in time and substance to the protected activity, and whether the retaliation is ongoing.

Evidence should weigh: whether a clear causal link is drawn between the protected activity and the adverse treatment (timing, explicit statements, a documented change in treatment), versus a retaliation claim based only on suspicion or coincidence.`,

  burnout: `Category: Burnout - sustained work-related exhaustion that is affecting the reporter's health.

Severity should weigh: the duration and intensity of the exhaustion described, whether it has produced concrete health effects (sleep, physical symptoms, mental health) rather than general tiredness, and whether the reporter describes an inability to recover (e.g. exhaustion that persists through time off).

Evidence should weigh: whether the account describes specific, sustained conditions (hours, workload changes, unmanageable deadlines) rather than only a general feeling, and whether the described impact is consistent with the described workload.`,
}

function formatResponseValue(response) {
  if (Array.isArray(response.value)) {
    return response.value.length > 0 ? response.value.join(', ') : '(none selected)'
  }
  if (response.value === '' || response.value === undefined || response.value === null) {
    return '(no answer)'
  }
  return String(response.value)
}

function formatResponse(response) {
  const lines = [`- ${response.questionId} (${response.type}): ${formatResponseValue(response)}`]
  if (response.severityWeight !== null && response.severityWeight !== undefined) {
    lines.push(`  reported severity weight: ${JSON.stringify(response.severityWeight)}`)
  }
  if (response.crisisCheckCandidate) {
    lines.push('  flagged upstream as a field to check for crisis language')
  }
  return lines.join('\n')
}

function formatResponses(responses) {
  return responses.map(formatResponse).join('\n')
}

// The wrapper for injected company policy context. Kept here so every AI call
// site that grounds against policy frames it identically: reference material
// that informs what detail matters and what procedure applies, never what the
// outcome should be. An empty policyContext produces an empty string, so a
// company that has uploaded nothing yields a prompt byte-identical to today's.
const POLICY_CONTEXT_PREAMBLE = `The following is the company's own written policy, provided as reference material only. Use it to understand what detail matters and what procedure the company's own rules make relevant. It does not change how you score or what you decide - it never tells you the outcome, only informs what the account should be measured against. Do not quote it as a finding, and do not conclude that the reported conduct violates it.`

function formatPolicyContext(policyContext) {
  if (typeof policyContext !== 'string' || !policyContext.trim()) return ''
  return `\n\nCompany policy context (reference only):\n${POLICY_CONTEXT_PREAMBLE}\n\n${policyContext.trim()}`
}

// category: one of the CATEGORIES ids in src/data/categories.js.
// responses: the { questionId, type, value, severityWeight, crisisCheckCandidate }
// array produced by QuestionnaireForm.jsx.
// policyContext: optional string from retrievePolicyContext.getPolicyContext().
// When absent or empty the returned prompt is identical to the ungrounded one.
// Returns { system, user } ready to pass to the Messages API.
function buildScoringPrompt(category, responses, policyContext) {
  const rubric = CATEGORY_RUBRICS[category]
  if (!rubric) {
    throw new Error(`No scoring rubric for case category "${category}"`)
  }

  const user = `Category: ${category}\n\nQuestionnaire responses:\n${formatResponses(responses)}`

  return {
    system: `${BASE_INSTRUCTIONS}\n\n${rubric}${formatPolicyContext(policyContext)}`,
    user,
  }
}

module.exports = { buildScoringPrompt, formatPolicyContext }
