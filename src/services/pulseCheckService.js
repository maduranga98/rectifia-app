import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

const PULSE_RESPONSES_COLLECTION = 'pulseResponses'
const PULSE_SUMMARIES_COLLECTION = 'pulseSummaries'

const submitPulseResponseCallable = httpsCallable(functions, 'submitPulseResponse')
const validatePulseInviteCallable = httpsCallable(functions, 'validatePulseInvite')

// Checks a single-use invite (inviteId + token from the employee's link)
// before the survey is rendered, without spending it. A roster employee has no
// account, so this token is their only credential - there is no sign-in step.
//
// Returns one of:
//   { valid: true, invite: { companyId, department, companyName } }
//   { valid: false, reason: 'used' | 'expired' | 'invalid' }
// `companyName` is shown to the employee so they can tell a genuine invite
// from a phishing link; `reason` lets the page explain used/expired/invalid
// distinctly - and 'used' is a confirmation, not an error (their response is
// already on file).
export async function validatePulseInvite({ inviteId, token }) {
  if (!inviteId || !token) {
    throw new Error('A valid pulse-check invite is required')
  }
  const result = await validatePulseInviteCallable({ inviteId, token })
  return result.data
}

// Submits a pulse-check response using the invite token as the credential.
// companyId, department and employeeId are NOT in this payload: the server
// reads them off the invite document (functions/src/intake/
// analyzePulseResponse.js) and spends the invite in the same transaction that
// writes the response, so this call can neither submit as someone else nor be
// replayed once the invite is used.
export async function submitPulseResponse({ inviteId, token, answers }) {
  if (!inviteId || !token) {
    throw new Error('A valid pulse-check invite is required')
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error('At least one answer is required')
  }
  const result = await submitPulseResponseCallable({ inviteId, token, answers })
  return result.data
}

// Individual, named responses plus their AI analysis - readable only by HR
// Coordinator / Pulse Check Reviewer per firestore.rules. There is no
// client-side filtering here: a Manager's auth token simply has no rules
// path to this collection, so calling this as a Manager fails at the
// Firestore layer, not because the UI chose not to show it.
export async function listPulseResponses(companyId) {
  const snapshot = await getDocs(
    query(collection(firestore, PULSE_RESPONSES_COLLECTION), where('companyId', '==', companyId))
  )
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// Department/period aggregates only - no individual attribution. This is
// the only pulse-check read available to the Manager role; it is a
// genuinely different collection, populated by a Cloud Function aggregation
// step, not a filtered view of listPulseResponses.
export async function listPulseSummaries(companyId) {
  const snapshot = await getDocs(
    query(collection(firestore, PULSE_SUMMARIES_COLLECTION), where('companyId', '==', companyId))
  )
  return snapshot.docs.map((d) => {
    const data = d.data()
    const averageSentiment = data.responseCount > 0 ? Math.round(data.sentimentScoreSum / data.responseCount) : null
    return { id: d.id, ...data, averageSentiment }
  })
}
