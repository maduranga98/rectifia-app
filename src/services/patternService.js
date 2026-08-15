import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { auth, firestore } from './firebase'
import i18n from './i18n'

const PATTERN_SIGNALS_COLLECTION = 'patternSignals'
const PATTERN_SUMMARIES_COLLECTION = 'patternSignalSummaries'
const BURNOUT_TREND_SIGNALS_COLLECTION = 'burnoutTrendSignals'
const BURNOUT_TREND_SUMMARIES_COLLECTION = 'burnoutTrendSummaries'

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

// Company-wide burnout trend signals, for the HR Coordinator only - same
// role boundary as listCompanyPatternSignals above, enforced the same way in
// firestore.rules. There is deliberately no Case Handler-scoped variant like
// listHandlerPatternSignals below: a burnout trend signal has no caseIds or
// handlerIds field to match a handler's assignments against, because it
// isn't derived from any handler's assigned cases - it is department-level
// report volume, not a per-case cluster.
export async function listCompanyBurnoutTrendSignals(companyId) {
  const snapshot = await getDocs(
    query(collection(firestore, BURNOUT_TREND_SIGNALS_COLLECTION), where('companyId', '==', companyId))
  )
  return snapshot.docs.map(serialize)
}

// The burnout trend run summary - counts and thresholds only, same
// "distinguish no signal from a suppressed one" purpose as
// getPatternSignalSummary below.
export async function getBurnoutTrendSummary(companyId) {
  const snapshot = await getDoc(doc(firestore, BURNOUT_TREND_SUMMARIES_COLLECTION, companyId))
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
export function signalTypeLabel(signalType) {
  return i18n.t(`patternService.signalTypeLabel.${signalType}`, { defaultValue: null })
}

export const SIGNAL_TYPE_TONE = {
  same_category: 'tone-info',
  cross_category: 'tone-neutral',
}

export function describeSignal(signal) {
  return i18n.t('patternService.describeSignal', {
    count: signal.caseCount,
    windowDays: signal.windowDays,
    context: signal.signalType === 'cross_category' ? 'crossCategory' : undefined,
  })
}

export function caseCountCaveat() {
  return i18n.t('patternService.caseCountCaveat')
}

export function crossCategoryCaveat() {
  return i18n.t('patternService.crossCategoryCaveat')
}
