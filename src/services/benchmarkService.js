import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// Module 25's client boundary. Nothing here talks to Firestore directly - the
// benchmarkCells / benchmarkOptIns / benchmarkRuns collections are all sealed
// in firestore.rules and every read goes through a callable that gates on
// "this company is currently opted in to contributing", because reading a
// pool without contributing to it collapses the pool. Keep this service as
// the only import path for benchmark data.
const getBenchmarksForCompanyCallable = httpsCallable(functions, 'getBenchmarksForCompany')
const setBenchmarkOptInCallable = httpsCallable(functions, 'setBenchmarkOptIn')
const getBenchmarkCatalogCallable = httpsCallable(functions, 'getBenchmarkCatalog')

export async function getBenchmarksForCompany() {
  const result = await getBenchmarksForCompanyCallable({})
  return result.data
}

// acknowledged is required by the callable and false-by-default here so a
// caller cannot omit the flag and silently satisfy the precondition.
export async function setBenchmarkOptIn({
  optedIn,
  industry = null,
  employeeCount = null,
  acknowledged = false,
}) {
  const result = await setBenchmarkOptInCallable({
    optedIn,
    industry,
    employeeCount,
    acknowledged,
  })
  return result.data
}

export async function getBenchmarkCatalog() {
  const result = await getBenchmarkCatalogCallable({})
  return result.data
}

// Human-readable label for one of the actionTaken keys the pool publishes.
// Mirrors functions/src/consistency/actionVocabulary.js's ACTION_SEVERITY_RANK
// - kept as a plain object rather than re-derived so a translation layer can
// swap in later without walking the callable's response shape.
export const ACTION_LABELS = {
  no_action: 'No action',
  coaching: 'Coaching',
  verbal_warning: 'Verbal warning',
  written_warning: 'Written warning',
  performance_improvement_plan: 'Performance improvement plan',
  suspension: 'Suspension',
  demotion: 'Demotion',
  termination: 'Termination',
}

export const CATEGORY_LABELS = {
  harassment: 'Harassment',
  toxicManagement: 'Toxic management',
  retaliation: 'Retaliation',
  burnout: 'Burnout',
}

export const INDUSTRY_LABELS = {
  technology: 'Technology',
  finance: 'Finance & insurance',
  healthcare: 'Healthcare',
  manufacturing: 'Manufacturing',
  retail: 'Retail',
  education: 'Education',
  hospitality: 'Hospitality & food service',
  construction: 'Construction',
  transportation: 'Transportation & logistics',
  professional_services: 'Professional services',
  nonprofit: 'Nonprofit',
  government: 'Government & public sector',
  media: 'Media & entertainment',
  energy: 'Energy & utilities',
  other: 'Other',
}
