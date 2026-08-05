import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

const COMPANIES_COLLECTION = 'companies'
const QUESTION_SETS_SUBCOLLECTION = 'questionSets'

// Callable wrappers for the Pulse Check questionnaire (module 21), in the same
// shape as pulseCheckService.js: thin, argument-validating, and with no
// authorization logic of their own - every role and company check lives
// server-side in functions/src/pulse/questionSet.js, which reads the caller's
// company off their verified custom claim rather than anything sent from here.

const getPublishedQuestionSetCallable = httpsCallable(functions, 'getPublishedQuestionSet')
const saveSupplementaryQuestionsCallable = httpsCallable(functions, 'saveSupplementaryQuestions')
const publishQuestionSetCallable = httpsCallable(functions, 'publishQuestionSet')
const sendTestPulseInviteCallable = httpsCallable(functions, 'sendTestPulseInvite')

// The cap and the text limit are enforced server-side; these mirrors exist only
// so the editor can show a live count and disable "Add" at the ceiling instead
// of letting someone type a fifth question and then be refused. A drift here
// can make the UI stricter or laxer than the server, never the stored data.
export const MAX_SUPPLEMENTARY_QUESTIONS = 4
export const MAX_QUESTION_TEXT_LENGTH = 200

// Returns:
//   {
//     published: { version, coreVersion, questions[], publishedAt, publishedByUid },
//     draft: [...],                  // unpublished working copy
//     activeQuestionSetVersion,      // null until the first publish
//     coreVersion, maxSupplementaryQuestions, maxQuestionTextLength, callerRole
//   }
// `published` falls back to the core-only set for a company that has never
// published, so there is always something to render.
export async function getPublishedQuestionSet(companyId) {
  const result = await getPublishedQuestionSetCallable({ companyId })
  return result.data
}

// Saves the working copy. This does NOT change what any employee receives -
// nothing goes live until publishQuestionSet is called. Company Admin only.
export async function saveSupplementaryQuestions(companyId, questions) {
  if (!Array.isArray(questions)) {
    throw new Error('questions must be an array')
  }
  const result = await saveSupplementaryQuestionsCallable({ companyId, questions })
  return result.data
}

// Freezes the current draft as a new immutable version and points the company
// at it. Invites minted from here on carry the new version; invites already in
// employees' inboxes keep the version they were sent with. Company Admin only.
export async function publishQuestionSet(companyId) {
  const result = await publishQuestionSetCallable({ companyId })
  return result.data
}

// Mails the CALLER a real pulse-check link so they can walk what employees get.
// There is deliberately no recipient argument: the address is read from the
// caller's own staff record server-side. The resulting response is marked as a
// test and is excluded from analysis, aggregates and the response list.
export async function sendTestPulseInvite(companyId) {
  const result = await sendTestPulseInviteCallable({ companyId })
  return result.data
}

// Every published version this company has ever had, oldest first. Readable by
// any staff member (firestore.rules grants read to company staff, and write to
// nobody at all - versions are published exclusively through the Admin SDK).
//
// Two readers need this and both need EVERY version, not just the current one:
// the response list, which must show each answer beside the question that was
// actually asked at the time, and the trend view, which marks the points on the
// timeline where the questionnaire changed.
export async function listQuestionSetVersions(companyId) {
  const snapshot = await getDocs(
    query(
      collection(firestore, COMPANIES_COLLECTION, companyId, QUESTION_SETS_SUBCOLLECTION),
      orderBy('version', 'asc')
    )
  )
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// version -> question set, for resolving a stored response's questionSetVersion
// to the wording it was answering. A response whose version is null (or points
// at a version that no longer resolves) is NOT silently shown against the
// current questionnaire - callers get `undefined` and are expected to say the
// wording is unavailable rather than imply a question was asked that wasn't.
export function indexQuestionSetsByVersion(versions) {
  return new Map((versions ?? []).map((v) => [Number(v.version), v]))
}

// Sorts a resolved question list for display: core first (in its fixed order),
// then supplementary. Used everywhere a question set is rendered so the survey,
// the preview and the admin editor can never disagree about ordering.
export function sortQuestions(questions) {
  const tierRank = (q) => (q.tier === 'supplementary' ? 1 : 0)
  return [...(questions ?? [])].sort(
    (a, b) => tierRank(a) - tierRank(b) || (a.order ?? 0) - (b.order ?? 0)
  )
}
