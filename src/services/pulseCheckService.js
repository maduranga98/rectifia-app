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
//
// Failures are thrown, not folded into `reason`, and the caller is expected to
// tell them apart by `err.code` rather than showing one message for
// everything: 'resource-exhausted' means the invite is over its attempt budget
// (a new link arrives with the next check-in - there is deliberately no resend
// path), while 'unavailable'/'internal' and outright network failures are
// transient problems on our side and worth retrying. Validating never spends
// the invite, so a retry is always safe.
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

// Firestore rejects an `in` filter with more than 30 values, so a manager
// scoped to more than 30 departments (unlikely, but possible) has their filter
// split into several queries whose results are merged.
const FIRESTORE_IN_LIMIT = 30

function chunk(values, size) {
  const chunks = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

function projectSummary(d) {
  const data = d.data()
  const suppressed = data.suppressed !== false
  return {
    id: d.id,
    ...data,
    suppressed,
    averageSentiment: suppressed ? null : data.averageSentiment ?? null,
  }
}

// Department/period aggregates only - no individual attribution. This is
// the only pulse-check read available to the Manager and Company Admin roles;
// it is a genuinely different collection, populated by a Cloud Function
// aggregation step, not a filtered view of listPulseResponses.
//
// This intentionally does NOT filter on suppressed: a suppressed department
// still renders as a card (showing its responseCount and a "hidden until N
// responses" state), because a department with too few responses to average is
// itself a signal a manager should see, not something to silently drop. The
// privacy guarantee no longer lives in a query filter: averageSentiment is a
// pre-projected field, written as null server-side for any below-floor
// department, so the number that could re-identify one person's answer never
// reaches this collection at all. This service reads that field verbatim - it
// never divides a sum by a count, because the raw sentimentScoreSum lives only
// in pulseSummaryTotals, to which no client role has any rules path.
//
// A doc with no `suppressed` field predates this change (when the projection
// carried sentimentScoreSum instead); treat it as suppressed and drop any
// averageSentiment it may carry - fail closed rather than surface a legacy
// average that might sit below the floor. HR Coordinator / Pulse Check Reviewer
// never call this; they read individual responses instead.
//
// `departments` is the Manager scope. When passed, the query MUST carry a
// matching where('department','in',...) or firestore.rules rejects the read
// whole - the manager clause on pulseSummaries requires the department be in the
// manager's `departments` claim, and Firestore refuses a query broader than what
// the rules allow. The names must be read off the caller's ID token claim, never
// a Firestore lookup. Company Admin passes no `departments` and reads every
// non-suppressed aggregate for its company, unchanged. An empty scope is caller
// error - fail closed and return nothing rather than issue an unscoped query the
// rules would reject anyway.
export async function listPulseSummaries(companyId, departments) {
  if (departments !== undefined) {
    if (!Array.isArray(departments) || departments.length === 0) {
      return []
    }
    const snapshots = await Promise.all(
      chunk(departments, FIRESTORE_IN_LIMIT).map((names) =>
        getDocs(
          query(
            collection(firestore, PULSE_SUMMARIES_COLLECTION),
            where('companyId', '==', companyId),
            where('department', 'in', names)
          )
        )
      )
    )
    // De-duplicate by doc id: the chunks are disjoint department sets, so this
    // is only defensive, but a manager should never see a department doubled.
    const byId = new Map()
    for (const snapshot of snapshots) {
      for (const d of snapshot.docs) byId.set(d.id, projectSummary(d))
    }
    return Array.from(byId.values())
  }

  const snapshot = await getDocs(
    query(collection(firestore, PULSE_SUMMARIES_COLLECTION), where('companyId', '==', companyId))
  )
  return snapshot.docs.map(projectSummary)
}
