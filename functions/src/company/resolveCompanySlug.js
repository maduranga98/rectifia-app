const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

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
  return { companyId: doc.id, companyName: doc.data().name ?? null }
}

exports.resolveCompanyBySlug = resolveCompanyBySlug

// Public, unauthenticated lookup used by the anonymous reporter's Submit page
// to turn a /submit/:companySlug link into a company it can name on screen.
// It deliberately exposes ONLY { companyId, companyName } for a slug the
// caller already holds - never the full company document, and never a way to
// list or enumerate slugs. An unknown slug returns { found: false } so the UI
// can show a clear "this reporting link isn't valid" message instead of a
// blank form. No auth by design: company resolution has to stay anonymous, the
// same way case submission does.
exports.resolveCompanySlug = onCall(async (request) => {
  const { companySlug } = request.data || {}

  if (typeof companySlug !== 'string' || !companySlug.trim()) {
    throw new HttpsError('invalid-argument', 'A company slug is required')
  }

  const resolved = await resolveCompanyBySlug(companySlug)
  if (!resolved) {
    return { found: false }
  }

  return { found: true, companyId: resolved.companyId, companyName: resolved.companyName }
})
