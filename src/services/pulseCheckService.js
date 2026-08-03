import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

const PULSE_RESPONSES_COLLECTION = 'pulseResponses'
const PULSE_SUMMARIES_COLLECTION = 'pulseSummaries'

const submitPulseResponseCallable = httpsCallable(functions, 'submitPulseResponse')

// Submits a pulse-check response as the signed-in employee. The employee
// identity comes from the caller's Firebase Auth session server-side
// (functions/src/intake/analyzePulseResponse.js), never from a field in this
// payload - so this call can never submit a response on someone else's
// behalf.
export async function submitPulseResponse({ companyId, department, answers }) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error('At least one answer is required')
  }
  const result = await submitPulseResponseCallable({ companyId, department, answers })
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
