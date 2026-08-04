import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export const CASE_ID_PATTERN = /^RC-\d{4}-\d{4}$/
export const MIN_PASSCODE_LENGTH = 10

const submitCaseCallable = httpsCallable(functions, 'submitCase')
const validateCaseAccessCallable = httpsCallable(functions, 'validateCaseAccess')

// Files a completed questionnaire as a new case and returns its one-time
// access credentials. `submission` is the { category, responses } payload
// QuestionnaireForm produces. The server writes the category and answers onto
// the case at creation (see functions/src/intake/submitCase.js) so scoring can
// run immediately, and issues the passcode server-side. The passcode is only
// ever available in this response - callers must surface it to the reporter
// immediately, since it cannot be recovered later.
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
