import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { firestore } from './firebase'

export const JURISDICTIONS = ['EU', 'UK', 'US', 'LK']

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
  subscriptionTier,
}) {
  if (!name?.trim()) {
    throw new Error('Company name is required')
  }
  const invalidJurisdictions = jurisdictions.filter(
    (j) => !JURISDICTIONS.includes(j)
  )
  if (!jurisdictions?.length || invalidJurisdictions.length) {
    throw new Error('At least one valid jurisdiction is required')
  }

  const docRef = await addDoc(collection(firestore, COMPANIES_COLLECTION), {
    name: name.trim(),
    jurisdictions,
    departments,
    subscriptionTier,
    createdAt: serverTimestamp(),
  })

  return docRef.id
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
