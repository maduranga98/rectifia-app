import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestore, functions } from './firebase'

export const JURISDICTIONS = ['EU', 'UK', 'US', 'LK']

// Pulse-check cadences the Company Admin can pick. The three sending cadences
// must match the keys of CADENCE_DAYS in
// functions/src/intake/schedulePulseChecks.js exactly - the scheduler looks
// the stored value up in that map, so a mismatched string reads as "do not
// send". 'off' is the UI-only option that maps to null on write.
export const PULSE_CADENCES = ['off', 'weekly', 'biweekly', 'monthly']

// Billing plans a Super Admin can put a newly registered company on. Lives
// here rather than in the form component so createCompany can validate what
// it's given instead of writing an arbitrary string into the doc.
export const SUBSCRIPTION_TIERS = ['starter', 'professional', 'enterprise']

// Compliance strictness ranking, most strict first. When a company selects
// multiple jurisdictions, the default timeline is driven by whichever
// jurisdiction ranks highest here (EU's 7-day/3-month rule), until a later
// module lets a user override the timeline per-jurisdiction.
const JURISDICTION_STRICTNESS_ORDER = ['EU', 'UK', 'US', 'LK']

const COMPANIES_COLLECTION = 'companies'

// Turns a company name into a URL-safe slug: lowercase, non-alphanumeric runs
// collapsed to single hyphens, no leading/trailing hyphens. This is the
// public identifier that appears in a reporting link (/submit/:companySlug),
// so it must never contain anything that needs URL-encoding or that leaks the
// exact legal name formatting.
export function slugifyCompanyName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Finds a slug that isn't already taken by another company. The base slug
// derived from the name is tried first; on a collision it appends -2, -3, ...
// Callers are a Super Admin (createCompany) or a Company Admin generating a
// link for their own company after the fact (assignCompanySlug); firestore.rules
// permits the existence probe below for both, but only as a limit(1) query -
// hence the explicit limit, which is also all the check needs. The slug is what
// an unauthenticated reporter's link resolves against, so it has to be unique
// across the whole platform - not per company.
export async function allocateUniqueSlug(name) {
  const base = slugifyCompanyName(name) || 'company'
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const snapshot = await getDocs(
      query(
        collection(firestore, COMPANIES_COLLECTION),
        where('slug', '==', candidate),
        limit(1)
      )
    )
    if (snapshot.empty) {
      return candidate
    }
  }
  // Astronomically unlikely with 50 name-based attempts; fall back to a
  // random suffix rather than blocking company creation outright.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

function createDepartmentId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `dept_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function createDepartment({ name, headUserId = null }) {
  return {
    id: createDepartmentId(),
    name,
    headUserId,
  }
}

// Returns the jurisdiction whose compliance rules are the strictest among
// those selected. Does not compute or store any deadline itself — that
// belongs to module 11.
export function getStrictestJurisdiction(jurisdictions = []) {
  return (
    JURISDICTION_STRICTNESS_ORDER.find((j) => jurisdictions.includes(j)) ??
    null
  )
}

export async function createCompany({
  name,
  jurisdictions,
  departments = [],
  subscriptionTier = SUBSCRIPTION_TIERS[0],
}) {
  if (!name?.trim()) {
    throw new Error('Company name is required')
  }
  // Length check first: filtering an undefined jurisdictions list threw a
  // TypeError before this, which surfaced as a raw crash instead of the
  // message below.
  if (!jurisdictions?.length || jurisdictions.some((j) => !JURISDICTIONS.includes(j))) {
    throw new Error('At least one valid jurisdiction is required')
  }
  if (!SUBSCRIPTION_TIERS.includes(subscriptionTier)) {
    throw new Error('A valid subscription tier is required')
  }

  // Unique, URL-safe reporting slug allocated at creation time - this is what
  // /submit/:companySlug resolves against so anonymous reporters can file
  // against the right company without ever being handed a raw companyId.
  const slug = await allocateUniqueSlug(name)

  const docRef = await addDoc(collection(firestore, COMPANIES_COLLECTION), {
    name: name.trim(),
    slug,
    jurisdictions,
    departments,
    subscriptionTier,
    // The Super Admin overview reads these three; seeding them at creation
    // is what stops a brand new company rendering as "Unknown"/"—" there.
    billingStatus: 'active',
    currentPeriodCaseCount: 0,
    createdAt: serverTimestamp(),
  })

  return docRef.id
}

const createCompanyAdminCallable = httpsCallable(functions, 'createCompanyAdmin')

// Creates the Company Admin account for a newly registered company and
// returns { email, password } so the Super Admin can hand the credentials
// over directly. No invite email is sent for now - see
// functions/src/company/createCompanyAdmin.js. The password comes back once
// and is never stored, so whatever calls this has to display it immediately.
export async function createCompanyAdmin({ companyId, email }) {
  if (!companyId || !email?.trim()) {
    throw new Error('companyId and an admin email are required')
  }
  const result = await createCompanyAdminCallable({
    companyId,
    email: email.trim(),
  })
  return result.data
}

// Company-level metadata only (name, subscriptionTier, case-count fields) -
// used by SuperAdminDashboardPage, which per Module 2's no-case-content-
// access rule must never read from `cases`, `caseMetadata`, or any
// messages/questionnaire subcollection.
export async function listCompanies() {
  const snapshot = await getDocs(collection(firestore, COMPANIES_COLLECTION))
  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    // Newest first, sorted client-side on purpose: an orderBy('createdAt')
    // query silently drops companies created before that field existed.
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
}

export async function getCompany(companyId) {
  const snapshot = await getDoc(doc(firestore, COMPANIES_COLLECTION, companyId))
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
}

// Self-service repair for a company that predates the slug field (or whose
// creation never got one): allocates a slug with the exact same function
// createCompany uses, so format and platform-wide uniqueness are identical
// either way, and writes it onto the company doc. Only a Company Admin for
// that company can do this - firestore.rules allows the slug field to be
// written only by that role, and only while it is still missing, so a link
// that has already been printed on a poster can never be reassigned out from
// under the reporters using it.
export async function assignCompanySlug(companyId, name) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  // Re-read rather than trusting the caller's copy: if another admin generated
  // the link in a different tab, reuse theirs instead of overwriting it (the
  // rules would reject the write anyway).
  const existing = await getCompany(companyId)
  if (!existing) {
    throw new Error('Company not found')
  }
  if (existing.slug) {
    return existing.slug
  }

  const slug = await allocateUniqueSlug(name ?? existing.name)
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), { slug })
  return slug
}

export async function updateCompanyJurisdictions(companyId, jurisdictions) {
  const invalidJurisdictions = jurisdictions.filter(
    (j) => !JURISDICTIONS.includes(j)
  )
  if (!jurisdictions?.length || invalidJurisdictions.length) {
    throw new Error('At least one valid jurisdiction is required')
  }
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    jurisdictions,
  })
}

// Writes companies/{companyId}.pulseCheckCadence, the cadence
// schedulePulseChecks.js reads. Only 'weekly' | 'biweekly' | 'monthly' - the
// exact CADENCE_DAYS keys - are ever persisted as a string; 'off' (or anything
// unrecognised) is stored as null. That matters: the scheduler treats an
// unknown cadence as "do not send", so null is the one explicit, deliberate way
// to turn pulse checks off, rather than leaving a stray string the scheduler
// would silently ignore and a future map change might accidentally revive.
//
// lastPulseCheckSentAt is deliberately never touched here - only
// schedulePulseChecks.js writes that field, when a send actually goes out.
export async function updateCompanyPulseCadence(companyId, cadence) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  const value = ['weekly', 'biweekly', 'monthly'].includes(cadence) ? cadence : null
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    pulseCheckCadence: value,
  })
}

export async function updateCompanyDepartments(companyId, departments) {
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    departments,
  })
}
