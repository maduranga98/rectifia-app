import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { firestore } from './firebase'

export const JURISDICTIONS = ['EU', 'UK', 'US', 'LK']

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

  const docRef = await addDoc(collection(firestore, COMPANIES_COLLECTION), {
    name: name.trim(),
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

export async function updateCompanyDepartments(companyId, departments) {
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    departments,
  })
}
