// The client-side crisis check. This runs ENTIRELY in the browser: the partial
// draft text a reporter is typing is never sent anywhere for this purpose. Its
// only job is to decide, in the moment, whether to offer support resources on
// the same screen - fast, before any server round trip, because the server's
// crisisFlag arrives only after submission, which is too late to be the primary
// path.
//
// The trigger list is a SINGLE module-local constant, and it is deliberately
// narrow and high-bar - matching the same narrow standard the backend scorer is
// held to (see functions/src/intake/prompts/scoringPrompt.js: crisisFlag is set
// only for an explicit statement of intent to harm oneself or an immediate
// danger, never for conduct that is merely severe, upsetting, or ongoing).
//
// A false positive here is not harmless: showing crisis resources to someone
// reporting ordinary workplace harm is patronising. So this matches only
// explicit first-person statements, and it never names or describes any method
// of self-harm - not here, not in copy, not anywhere in this module.
//
// This check records nothing. It returns a boolean and has no side effects: no
// logging, no analytics, no storage.
const CRISIS_PHRASES = [
  'kill myself',
  'end my life',
  'take my own life',
  'want to die',
  "don't want to live",
  'dont want to live',
  'no reason to live',
  'better off dead',
  'suicidal',
  'suicide',
  'hurt myself',
  'harm myself',
]

// Returns true only when the text contains an explicit first-person crisis
// statement from the narrow list above. Empty or non-string input returns
// false. This does not attempt to be clever - it does not infer, pattern-match
// to a category, or score; anything short of an explicit phrase is treated as
// ordinary reporting.
export function textIndicatesCrisis(text) {
  if (typeof text !== 'string' || !text) return false
  const normalized = text.toLowerCase()
  return CRISIS_PHRASES.some((phrase) => normalized.includes(phrase))
}
