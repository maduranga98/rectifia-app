import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { auth, firestore } from './firebase'

const PATTERN_SIGNALS_COLLECTION = 'patternSignals'
const PATTERN_SUMMARIES_COLLECTION = 'patternSignalSummaries'

function serialize(docSnapshot) {
  return { id: docSnapshot.id, ...docSnapshot.data() }
}

// Company-wide signals, for the HR Coordinator. firestore.rules allows this
// read only for the hrCoordinator claim on the matching companyId - Company
// Admin and Manager have no path here at all, so the omission is a server-side
// boundary rather than a screen they simply aren't shown. A pattern signal is
// derived from case content, and Company Admin's role is defined by not having
// case content.
export async function listCompanyPatternSignals(companyId) {
  const snapshot = await getDocs(
    query(collection(firestore, PATTERN_SIGNALS_COLLECTION), where('companyId', '==', companyId))
  )
  return snapshot.docs.map(serialize)
}

// The run summary: how many signals fired, and how many groups were withheld
// because too few people matched them. Counts and thresholds only - it names
// no department, so it can be shown to explain an empty list without
// re-creating the disclosure the suppression prevented.
export async function getPatternSignalSummary(companyId) {
  const snapshot = await getDoc(doc(firestore, PATTERN_SUMMARIES_COLLECTION, companyId))
  return snapshot.exists() ? serialize(snapshot) : null
}

// A Case Handler's slice: signals that contain a case assigned to them,
// matched on handlerIds rather than on caseIds. That is what firestore.rules
// checks too, so a handler cannot widen this by querying differently - and
// crucially it does not give them a read path to any case in the signal. The
// case ids on a signal are for their own-case check below and for report
// compilation; they are not links and are never rendered.
export async function listHandlerPatternSignals() {
  const uid = auth.currentUser?.uid
  if (!uid) return []
  const snapshot = await getDocs(
    query(collection(firestore, PATTERN_SIGNALS_COLLECTION), where('handlerIds', 'array-contains', uid))
  )
  return snapshot.docs.map(serialize)
}

export function signalsContainingCase(signals, caseId) {
  return signals.filter((signal) => Array.isArray(signal.caseIds) && signal.caseIds.includes(caseId))
}

export function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

export function formatSignalDate(value) {
  const ms = toMillis(value)
  if (ms === null) return '—'
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Wording lives here, in one place, so both surfaces describe a signal the
// same way and neither can drift into concluding something. A signal states
// what was counted and over what period. It does not say a department has a
// problem, does not name a likely cause, and does not recommend an action -
// the same discipline module 10's consistency flag holds to.
export const SIGNAL_TYPE_LABEL = {
  same_category: 'Same category',
  cross_category: 'Across categories',
}

export const SIGNAL_TYPE_TONE = {
  same_category: 'tone-info',
  cross_category: 'tone-neutral',
}

export function describeSignal(signal) {
  const caseWord = signal.caseCount === 1 ? 'case' : 'cases'
  if (signal.signalType === 'cross_category') {
    return `${signal.caseCount} ${caseWord} across different categories in this department and role tier in the last ${signal.windowDays} days.`
  }
  return `${signal.caseCount} ${caseWord} in this department and role tier in the last ${signal.windowDays} days.`
}

export const CASE_COUNT_CAVEAT =
  'This counts cases, not people. Reports are anonymous, so one person filing several times and several people filing once look identical here.'

export const CROSS_CATEGORY_CAVEAT =
  'These cases are of different kinds. That is weaker than a cluster of the same kind of report and should not be read as repeated conduct.'
