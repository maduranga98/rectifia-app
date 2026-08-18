const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { PUBLIC_CALLABLE_OPTIONS, enforceRateLimit } = require('../utils/rateLimit')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'

// Normalizes a client-supplied slug the same way slugifyCompanyName does on
// the client (src/services/companyService.js), so a link that arrives with odd
// casing or surrounding whitespace still resolves rather than silently 404ing.
function normalizeSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

// Resolves a public reporting slug to the owning company. This is the single
// point of trust for slug -> companyId: submitCase.js calls it server-side so
// the companyId written onto a case can never be spoofed by the client, and
// the public resolveCompanySlug callable below calls it so an anonymous
// reporter's Submit page can validate the link. Returns null when no company
// owns the slug. Deliberately reads only the fields the reporter is allowed to
// see - never returns the raw company document.
//
// departments is included because the intake questionnaire's subject_department
// field is a select populated from it (see harassment.js) rather than free
// text - the anonymous reporter has no other read path to
// companies/{companyId}.departments, since firestore.rules gates the company
// doc on isCompanyStaff. Department names aren't identifying on their own, so
// exposing just the list here doesn't widen what a reporter can learn versus
// what the resolveCompanySlug callable already intended to expose.
async function resolveCompanyBySlug(slug) {
  const normalized = normalizeSlug(slug)
  if (!normalized) return null

  const snapshot = await admin
    .firestore()
    .collection(COMPANIES_COLLECTION)
    .where('slug', '==', normalized)
    .limit(1)
    .get()

  if (snapshot.empty) return null

  const doc = snapshot.docs[0]
  return {
    companyId: doc.id,
    companyName: doc.data().name ?? null,
    departments: doc.data().departments ?? [],
    // Not part of what the public resolveCompanySlug callable below exposes
    // (see its own comment) - submitCase.js reads this off the object
    // returned here to refuse new intake for a suspended company, without a
    // second Firestore read.
    suspended: doc.data().suspended === true,
  }
}

exports.resolveCompanyBySlug = resolveCompanyBySlug

// Public, unauthenticated lookup used by the anonymous reporter's Submit page
// to turn a /submit/:companySlug link into a company it can name on screen.
// It deliberately exposes ONLY { companyId, companyName, departments,
// suspended } for a slug the caller already holds - never the full company
// document, and never a way to list or enumerate slugs. An unknown slug
// returns { found: false } so the UI can show a clear "this reporting link
// isn't valid" message instead of a blank form. `suspended` lets Submit.jsx
// show "not currently accepting reports" up front, before a reporter spends
// time filling in the questionnaire, rather than only failing at the final
// submitCase call - submitCase.js re-checks it server-side regardless, since
// this lookup and the actual filing are two separate calls and the company
// could be suspended in between. No auth by design: company resolution has
// to stay anonymous, the same way case submission does.
exports.resolveCompanySlug = onCall(PUBLIC_CALLABLE_OPTIONS, async (request) => {
  const { companySlug } = request.data || {}

  // The loosest of the limits: one indexed read per call, and a whole office
  // behind one NAT may legitimately open the same reporting link. It exists to
  // stop slug enumeration, not to ration ordinary use.
  await enforceRateLimit(admin.firestore(), 'resolveCompanySlug', request)

  if (typeof companySlug !== 'string' || !companySlug.trim()) {
    throw new HttpsError('invalid-argument', 'A company slug is required')
  }

  const resolved = await resolveCompanyBySlug(companySlug)
  if (!resolved) {
    return { found: false }
  }

  return {
    found: true,
    companyId: resolved.companyId,
    companyName: resolved.companyName,
    departments: resolved.departments,
    suspended: resolved.suspended,
  }
})
