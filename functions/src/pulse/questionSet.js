const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  CORE_VERSION,
  QUESTION_TYPES,
  SCALE_LABELS,
  SCALE_MIN,
  SCALE_MAX,
  coreQuestionsForSet,
  isCoreQuestionId,
} = require('./coreQuestions')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const QUESTION_SETS_SUBCOLLECTION = 'questionSets'

// A company may add at most this many supplementary questions. The cap is a
// response-rate control as much as a storage one: the core set is four
// questions and takes under a minute, which is the whole reason people answer
// it. It is deliberately not company-configurable.
const MAX_SUPPLEMENTARY_QUESTIONS = 4
const MAX_QUESTION_TEXT_LENGTH = 200
const MAX_QUESTION_ID_LENGTH = 60

// Supplementary ids are namespaced so a resolved set can never have a
// supplementary question shadow a core one, and so a stored answer's tier is
// obvious from its questionId alone when reading an old response.
const SUPPLEMENTARY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/

// Roles allowed to read the published set: any staff member of the company.
// Reading the questionnaire discloses nothing about any individual - it is the
// questions, not the answers - and the HR-side preview, the admin editor and
// the test invite all need it.
const EDIT_ROLES = ['companyAdmin']

function normalizeSupplementaryQuestion(raw, index, seenIds) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', `Question ${index + 1} is not a question object`)
  }

  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) {
    throw new HttpsError('invalid-argument', `Question ${index + 1} needs some text`)
  }
  if (text.length > MAX_QUESTION_TEXT_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `Question ${index + 1} is longer than ${MAX_QUESTION_TEXT_LENGTH} characters`
    )
  }

  const type = raw.type
  if (!QUESTION_TYPES.includes(type)) {
    throw new HttpsError(
      'invalid-argument',
      `Question ${index + 1} must be a ${QUESTION_TYPES.join(' or ')} question`
    )
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id || id.length > MAX_QUESTION_ID_LENGTH || !SUPPLEMENTARY_ID_PATTERN.test(id)) {
    throw new HttpsError('invalid-argument', `Question ${index + 1} has an invalid id`)
  }
  // A supplementary question can never take a core question's id: an answer
  // keyed 'workload' must always mean the core workload question, in this
  // version and in every stored response that ever referenced one.
  if (isCoreQuestionId(id)) {
    throw new HttpsError(
      'invalid-argument',
      `"${id}" is a core question id and cannot be reused for an added question`
    )
  }
  if (seenIds.has(id)) {
    throw new HttpsError('invalid-argument', `Two added questions share the id "${id}"`)
  }
  seenIds.add(id)

  return {
    id,
    text,
    type,
    // Supplementary questions always sort after the core set. The stored order
    // is their position in the submitted list, offset past core.
    order: coreQuestionsForSet().length + index + 1,
    scaleLabels: type === 'scale' ? [...SCALE_LABELS] : null,
    tier: 'supplementary',
  }
}

// Validates and normalizes a whole supplementary list. Throws HttpsError on the
// first problem - this runs on a form submit, so one clear message about one
// question beats a list the editor would have to re-render.
function validateSupplementaryQuestions(questions) {
  if (!Array.isArray(questions)) {
    throw new HttpsError('invalid-argument', 'questions must be an array')
  }
  if (questions.length > MAX_SUPPLEMENTARY_QUESTIONS) {
    throw new HttpsError(
      'invalid-argument',
      `A company can add at most ${MAX_SUPPLEMENTARY_QUESTIONS} questions`
    )
  }
  const seenIds = new Set()
  return questions.map((raw, index) => normalizeSupplementaryQuestion(raw, index, seenIds))
}

// The core-only set. This is what a company with nothing published answers,
// and what any unresolvable version falls back to - core is always answerable.
function coreOnlySet(version = null) {
  return {
    version,
    coreVersion: CORE_VERSION,
    questions: coreQuestionsForSet(),
    publishedAt: null,
    publishedByUid: null,
  }
}

// THE shared resolver. Every consumer - the survey form, submit validation,
// the Claude prompt, the HR response reader - goes through this so that a
// version number always resolves to the exact question list it was frozen
// with.
//
// `version` null/undefined means "this company has never published", which
// resolves to core-only rather than to an error: an employee holding an invite
// must always have something answerable in front of them.
//
// A version that does not resolve (a doc that never existed) also falls back to
// core-only, but says so via `missing: true` so a reader can be told the
// supplementary wording could not be recovered rather than being shown the
// current set and left to assume it was what was asked.
async function resolveQuestionSet(companyId, version) {
  const numeric = Number(version)
  if (!companyId || !Number.isInteger(numeric) || numeric < 1) {
    return coreOnlySet(null)
  }

  const snapshot = await admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(QUESTION_SETS_SUBCOLLECTION)
    .doc(String(numeric))
    .get()

  if (!snapshot.exists) {
    logger.warn('resolveQuestionSet: no such published version', { companyId, version: numeric })
    return { ...coreOnlySet(numeric), missing: true }
  }

  const data = snapshot.data()
  return {
    version: numeric,
    coreVersion: data.coreVersion ?? null,
    questions: Array.isArray(data.questions) ? data.questions : coreQuestionsForSet(),
    publishedAt: data.publishedAt ?? null,
    publishedByUid: data.publishedByUid ?? null,
  }
}

// Resolves the version a NEW invite should be stamped with: whatever the
// company has published right now, or null if it has published nothing.
async function activeQuestionSetVersion(firestore, companyId) {
  const snapshot = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!snapshot.exists) return null
  const version = snapshot.data().activeQuestionSetVersion
  return Number.isInteger(version) && version >= 1 ? version : null
}

// Server-side validation of a submitted answers array against the question set
// the invite was minted with. Before module 21 the client was the only
// definition of a valid response: submitPulseResponse took any array of
// {questionId, value} and stored it verbatim, so an unknown questionId or a
// scale value of 9000 went straight into the doc the analysis and the
// aggregates are built from.
//
// Returns the cleaned answer list. Throws HttpsError on anything the set does
// not define. Answers are optional (an employee may skip any question), so a
// short list is fine - what is rejected is an answer to a question that does
// not exist, or a value the question's own type does not allow.
function validateAnswers(questionSet, answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new HttpsError('invalid-argument', 'answers are required')
  }
  const byId = new Map(questionSet.questions.map((q) => [q.id, q]))
  const seen = new Set()

  return answers.map((answer) => {
    if (!answer || typeof answer !== 'object') {
      throw new HttpsError('invalid-argument', 'Each answer must be an object')
    }
    const questionId = answer.questionId
    const question = byId.get(questionId)
    if (!question) {
      throw new HttpsError(
        'invalid-argument',
        'This response answers a question that is not part of the questionnaire it was sent'
      )
    }
    if (seen.has(questionId)) {
      throw new HttpsError('invalid-argument', 'A question was answered twice')
    }
    seen.add(questionId)

    if (question.type === 'scale') {
      const numeric = Number(answer.value)
      if (!Number.isInteger(numeric) || numeric < SCALE_MIN || numeric > SCALE_MAX) {
        throw new HttpsError(
          'invalid-argument',
          `Scale answers must be a whole number from ${SCALE_MIN} to ${SCALE_MAX}`
        )
      }
      // Stored as the string the form submits, unchanged from module 14, so
      // existing readers of `answers` keep working.
      return { questionId, value: String(numeric) }
    }

    const value = typeof answer.value === 'string' ? answer.value : ''
    if (value.length > 5000) {
      throw new HttpsError('invalid-argument', 'A free-text answer is too long')
    }
    return { questionId, value }
  })
}

// Renders answers with the question text they were actually answering.
// analyzeWithClaude used to send JSON.stringify(answers) - bare ids and values,
// so the model had to infer what "workload: 3" meant and had no idea what a
// company's added question was even asking. Every prompt now goes through this.
function describeAnswers(questionSet, answers) {
  const byId = new Map((questionSet?.questions ?? []).map((q) => [q.id, q]))
  const lines = (Array.isArray(answers) ? answers : []).map((answer) => {
    const question = byId.get(answer.questionId)
    if (!question) {
      return `- [question text unavailable] (${answer.questionId}): ${answer.value}`
    }
    const tier = question.tier === 'supplementary' ? ' [company-added]' : ''
    if (question.type === 'scale') {
      const index = Number(answer.value) - SCALE_MIN
      const label = question.scaleLabels?.[index]
      const scaleNote = label ? ` (${label})` : ''
      return `- ${question.text}${tier}: ${answer.value} of ${SCALE_MAX}${scaleNote}`
    }
    return `- ${question.text}${tier}: ${answer.value || '(left blank)'}`
  })
  return lines.length ? lines.join('\n') : '(no answers)'
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

// The current published set plus the unpublished draft, for the Company Admin
// editor and for the read-only preview any staff role can open. Staff-
// authenticated: the company is read off the caller's verified claim, and the
// requested companyId must match it, so no staff member can read another
// company's questionnaire.
exports.getPublishedQuestionSet = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()
  const companyId = request.data?.companyId || request.auth?.token?.companyId
  if (!companyId || companyId !== request.auth?.token?.companyId) {
    throw new HttpsError('permission-denied', 'You may only read your own company\'s questionnaire')
  }
  const role = await loadCallerRole(firestore, companyId, uid, 'question_set_read')
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'question_set_read', outcome: 'granted' })

  const companySnap = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
  if (!companySnap.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }
  const company = companySnap.data()
  const published = await resolveQuestionSet(companyId, company.activeQuestionSetVersion)

  return {
    published,
    // The working copy. Only the editor acts on it, but it is returned to every
    // staff role so a preview can honestly say "this is what is live" versus
    // "there are unpublished changes".
    draft: Array.isArray(company.supplementaryQuestionsDraft)
      ? company.supplementaryQuestionsDraft
      : [],
    activeQuestionSetVersion: company.activeQuestionSetVersion ?? null,
    coreVersion: CORE_VERSION,
    maxSupplementaryQuestions: MAX_SUPPLEMENTARY_QUESTIONS,
    maxQuestionTextLength: MAX_QUESTION_TEXT_LENGTH,
    callerRole: role,
  }
})

// Saves the working copy. Explicitly does NOT publish: nothing an employee or
// an HR reader sees changes until publishQuestionSet freezes a version. That
// separation is the whole reason editing is safe - a half-finished question
// cannot reach a workforce.
exports.saveSupplementaryQuestions = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()
  const companyId = request.auth?.token?.companyId
  if (!companyId || (request.data?.companyId && request.data.companyId !== companyId)) {
    throw new HttpsError('permission-denied', 'You may only edit your own company\'s questionnaire')
  }
  const role = await loadCallerRole(firestore, companyId, uid, 'question_set_save_draft')
  if (!EDIT_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'question_set_save_draft',
      outcome: 'denied:permission-denied',
      detail: 'role_not_edit_role',
    })
    throw new HttpsError(
      'permission-denied',
      'Only a Company Admin may change the pulse-check questionnaire'
    )
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'question_set_save_draft', outcome: 'granted' })

  const questions = validateSupplementaryQuestions(request.data?.questions ?? [])

  await firestore.collection(COMPANIES_COLLECTION).doc(companyId).update({
    supplementaryQuestionsDraft: questions,
    supplementaryQuestionsDraftUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    supplementaryQuestionsDraftUpdatedByUid: uid,
  })

  return { questions, published: false }
})

// Freezes the current draft as a new immutable version.
//
// Versions are additive and permanent: this only ever creates
// companies/{companyId}/questionSets/{version} with create() (never set/merge,
// never update), so an already-published version cannot be rewritten even by
// this function. A response stored six months ago must always be able to
// resolve the exact wording it was answering, including wording a company has
// since removed - removal changes the NEXT version, never the past ones.
exports.publishQuestionSet = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()
  const companyId = request.auth?.token?.companyId
  if (!companyId || (request.data?.companyId && request.data.companyId !== companyId)) {
    throw new HttpsError(
      'permission-denied',
      'You may only publish your own company\'s questionnaire'
    )
  }
  const role = await loadCallerRole(firestore, companyId, uid, 'question_set_publish')
  if (!EDIT_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'question_set_publish',
      outcome: 'denied:permission-denied',
      detail: 'role_not_edit_role',
    })
    throw new HttpsError(
      'permission-denied',
      'Only a Company Admin may publish the pulse-check questionnaire'
    )
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'question_set_publish', outcome: 'granted' })

  const companyRef = firestore.collection(COMPANIES_COLLECTION).doc(companyId)

  const version = await firestore.runTransaction(async (tx) => {
    const companySnap = await tx.get(companyRef)
    if (!companySnap.exists) {
      throw new HttpsError('not-found', 'Company not found')
    }
    const company = companySnap.data()

    // Re-validated at publish time rather than trusted from the draft write:
    // the draft is a stored document, and what gets frozen forever should be
    // checked against the current rules at the moment it is frozen.
    const supplementary = validateSupplementaryQuestions(
      Array.isArray(company.supplementaryQuestionsDraft) ? company.supplementaryQuestionsDraft : []
    )

    // The counter only ever goes up, and never reuses a number even if
    // activeQuestionSetVersion were ever pointed elsewhere - a version number
    // is a permanent identity, not a slot.
    const previous = Number.isInteger(company.companyQuestionSetVersion)
      ? company.companyQuestionSetVersion
      : 0
    const next = previous + 1

    const versionRef = companyRef.collection(QUESTION_SETS_SUBCOLLECTION).doc(String(next))
    // create(), not set(): if a doc somehow already exists at this number the
    // transaction fails rather than overwriting immutable history.
    tx.create(versionRef, {
      version: next,
      coreVersion: CORE_VERSION,
      questions: [...coreQuestionsForSet(), ...supplementary],
      publishedByUid: uid,
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    tx.update(companyRef, {
      companyQuestionSetVersion: next,
      activeQuestionSetVersion: next,
    })

    return next
  })

  logger.info('publishQuestionSet: published', { companyId, version, actorUid: uid })

  const published = await resolveQuestionSet(companyId, version)
  return { version, published }
})

module.exports.resolveQuestionSet = resolveQuestionSet
module.exports.activeQuestionSetVersion = activeQuestionSetVersion
module.exports.validateAnswers = validateAnswers
module.exports.validateSupplementaryQuestions = validateSupplementaryQuestions
module.exports.describeAnswers = describeAnswers
module.exports.coreOnlySet = coreOnlySet
module.exports.MAX_SUPPLEMENTARY_QUESTIONS = MAX_SUPPLEMENTARY_QUESTIONS
module.exports.MAX_QUESTION_TEXT_LENGTH = MAX_QUESTION_TEXT_LENGTH
module.exports.QUESTION_SETS_SUBCOLLECTION = QUESTION_SETS_SUBCOLLECTION
