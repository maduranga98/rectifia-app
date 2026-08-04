import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export const CASE_ID_PATTERN = /^RC-\d{4}-\d{4}$/
export const MIN_PASSCODE_LENGTH = 10

const submitCaseCallable = httpsCallable(functions, 'submitCase')
const validateCaseAccessCallable = httpsCallable(functions, 'validateCaseAccess')
const resolveCompanySlugCallable = httpsCallable(functions, 'resolveCompanySlug')

// Resolves a public /submit/:companySlug link to the company it belongs to,
// returning only { found, companyId, companyName }. Used by the anonymous
// reporter's Submit page to confirm the link is valid and to name the company
// on screen before any category is chosen. Full company documents are never
// exposed here - the callable (functions/src/company/resolveCompanySlug.js)
// returns nothing but the id and display name, and there is no way to list
// slugs. Returns { found: false } for an unknown slug so the caller can show a
// clear "this reporting link isn't valid" message.
export async function resolveCompanySlug(companySlug) {
  const trimmed = companySlug?.trim() ?? ''
  if (!trimmed) {
    return { found: false }
  }
  const result = await resolveCompanySlugCallable({ companySlug: trimmed })
  return result.data
}

// Files a completed questionnaire as a new case and returns its one-time
// access credentials. `submission` is the { category, responses, companySlug }
// payload: the category/answers from QuestionnaireForm plus the slug from the
// reporter's /submit/:companySlug link. The slug (never a companyId) is sent to
// the server, which resolves it to a companyId itself (see
// functions/src/intake/submitCase.js) so a reporter can't file into another
// company's queue by tampering with the payload. The server writes the
// category, answers, and resolved companyId onto the case at creation so
// scoring and routing can run immediately, and issues the passcode
// server-side. The passcode is only ever available in this response - callers
// must surface it to the reporter immediately, since it cannot be recovered
// later.
export async function submitCase(submission) {
  const result = await submitCaseCallable(submission)
  return result.data
}

// Validates a Case ID + passcode pair against the server-side salted hash.
// Returns { valid: false } rather than throwing when the credentials are
// wrong, so callers can show a generic "incorrect" message without
// distinguishing an unknown Case ID from a wrong passcode.
export async function validateCaseAccess(caseId, passcode) {
  const trimmedCaseId = caseId?.trim() ?? ''
  if (!CASE_ID_PATTERN.test(trimmedCaseId)) {
    throw new Error('Enter a valid Case ID, e.g. RC-2026-8842')
  }
  if (!passcode || passcode.length < MIN_PASSCODE_LENGTH) {
    throw new Error('Enter your passcode')
  }

  const result = await validateCaseAccessCallable({
    caseId: trimmedCaseId,
    passcode,
  })
  return result.data
}
