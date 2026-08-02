import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export const CASE_ID_PATTERN = /^RC-\d{4}-\d{4}$/
export const MIN_PASSCODE_LENGTH = 10

const generateCaseAccessCallable = httpsCallable(functions, 'generateCaseAccess')
const validateCaseAccessCallable = httpsCallable(functions, 'validateCaseAccess')

// Asks the server to create a new case and issue its one-time passcode.
// The passcode is generated server-side (see
// functions/src/intake/generateCaseAccess.js) and is only ever available in
// this response - callers must surface it to the reporter immediately, since
// it cannot be recovered later.
export async function generateCaseAccess() {
  const result = await generateCaseAccessCallable()
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
