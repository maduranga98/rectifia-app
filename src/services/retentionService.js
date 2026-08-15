import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, firestore, functions } from './firebase'

const COMPANIES_COLLECTION = 'companies'

// Mirrors functions/src/retention/retentionPolicy.js exactly - both the
// constant values AND the resolution order below, which must stay in sync
// too, not just the numbers. Duplicated rather than imported (that is
// server-only Cloud Functions code) purely so this form can show and
// enforce the same floors/ceilings/defaults before a save is even
// attempted; firestore.rules enforces the real floor on every write, so a
// drift here could only make the form stricter than the server, never
// looser.
export const RETENTION_DEFAULTS = {
  identityRetentionDays: 365,
  caseRetentionDays: 2555,
  pulseResponseRetentionDays: 730,
  auditLogRetentionDays: 3650,
}

export const RETENTION_FLOORS = {
  identityRetentionDays: 90,
  caseRetentionDays: 1095,
  pulseResponseRetentionDays: 180,
  auditLogRetentionDays: 2555,
}

export const RETENTION_CEILINGS = {
  identityRetentionDays: 1825,
  caseRetentionDays: 3650,
  pulseResponseRetentionDays: 1825,
  auditLogRetentionDays: null,
}

// Mirrors functions/src/retention/retentionPolicy.js's JURISDICTION_RETENTION
// exactly - see that file for the derivation of each override. Engineering
// defaults pending employment-law review, not legal advice.
export const JURISDICTION_RETENTION = {
  EU: {
    caseRetentionDays: 1825,
    identityRetentionDays: 180,
    caseRetentionCeiling: 2555,
  },
  JP: {
    caseRetentionDays: 1825,
    caseRetentionCeiling: 3650,
  },
  AU: {
    caseRetentionDays: 2555,
    caseRetentionCeiling: 3650,
  },
}

function jurisdictionCeilingKey(key) {
  return key.replace(/Days$/, 'Ceiling')
}

// Mirrors resolveJurisdictionRetention() in
// functions/src/retention/retentionPolicy.js exactly: folds a company's
// jurisdictions into one set of per-key defaults and ceilings, strictest
// wins - the shortest default and the shortest ceiling among the company's
// matching jurisdictions, per key.
export function resolveJurisdictionRetention(jurisdictions = []) {
  const basis = (jurisdictions || []).filter((code) => JURISDICTION_RETENTION[code])
  const defaults = { ...RETENTION_DEFAULTS }
  const ceilings = { ...RETENTION_CEILINGS }

  for (const field of RETENTION_FIELDS) {
    const { key } = field
    const ceilingKey = jurisdictionCeilingKey(key)
    for (const code of basis) {
      const entry = JURISDICTION_RETENTION[code]
      if (typeof entry[key] === 'number' && entry[key] < defaults[key]) {
        defaults[key] = entry[key]
      }
      if (typeof entry[ceilingKey] === 'number') {
        if (typeof ceilings[key] !== 'number' || entry[ceilingKey] < ceilings[key]) {
          ceilings[key] = entry[ceilingKey]
        }
      }
    }
  }

  return { defaults, ceilings, basis }
}

export const RETENTION_FIELDS = [
  {
    key: 'identityRetentionDays',
    label: 'Reporter identity & contact data',
    description:
      'reporterIdentity, contactEmail, and push subscriptions - purged on this clock once a case is closed. Once an investigation is closed there is almost never a lawful basis to keep knowing who filed it.',
  },
  {
    key: 'caseRetentionDays',
    label: 'Case content',
    description:
      'The case narrative, messages, questionnaire answers, and evidence files - hard-deleted this many days after the case CLOSES, never from when it was created.',
  },
  {
    key: 'pulseResponseRetentionDays',
    label: 'Pulse Check responses',
    description:
      'Individual Pulse Check answers. The aggregated, k-anonymised summaries survive this window - only the individual responses that fed them are deleted.',
  },
  {
    key: 'auditLogRetentionDays',
    label: 'Audit logs',
    description:
      'identityAccessAuditLog, triageAccessLog, staffIntakeAuditLog and evidenceAccessLog. These run on their own clock and outlive the case they describe - a log proving who decrypted an identity is worthless if it is destroyed on the same schedule as the thing it protects.',
  },
]

function requireUid() {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('You must be signed in to manage retention settings')
  return uid
}

// Applies a company's jurisdictions and its own overrides on top of the
// defaults and clamps to floor/ceiling - the same function signature and
// behaviour as resolveRetentionPolicy() server-side, so what this page shows
// as "current" always matches what the next sweep would actually use, even
// for a company whose stored config predates a floor change or a
// newly-added jurisdiction.
//
// Resolution order, strictest-wins, mirroring the server exactly:
//   1. Start from the global RETENTION_DEFAULTS/RETENTION_CEILINGS.
//   2. Fold in the company's jurisdictions (resolveJurisdictionRetention).
//   3. Apply the company's own stored `retention` overrides on top.
//   4. Clamp against the global RETENTION_FLOORS (unchanged) and the
//      jurisdiction-resolved ceiling from step 2.
export function resolveRetentionPolicy(company) {
  const stored = company?.retention ?? {}
  const { defaults, ceilings, basis } = resolveJurisdictionRetention(company?.jurisdictions)

  const resolved = {}
  const resolvedCeilings = {}
  for (const field of RETENTION_FIELDS) {
    const { key } = field
    const candidate = stored[key]
    const base = Number.isInteger(candidate) && candidate > 0 ? candidate : defaults[key]
    const floor = RETENTION_FLOORS[key]
    const ceiling = ceilings[key]
    let clamped = base
    if (clamped < floor) clamped = floor
    if (typeof ceiling === 'number' && clamped > ceiling) clamped = ceiling
    resolved[key] = clamped
    resolvedCeilings[key] = ceiling
  }
  return { ...resolved, resolvedCeilings, jurisdictionBasis: basis }
}

// `ceilingOverride` lets a caller pass the jurisdiction-resolved ceiling
// (resolveRetentionPolicy(company).resolvedCeilings[key]) instead of the
// global one, so a company in EU sees an error at 2,555 days, not 3,650.
// Falls back to the global RETENTION_CEILINGS when omitted.
export function retentionFieldError(key, value, ceilingOverride) {
  const floor = RETENTION_FLOORS[key]
  const ceiling = ceilingOverride !== undefined ? ceilingOverride : RETENTION_CEILINGS[key]
  if (!Number.isInteger(value) || value <= 0) {
    return 'Enter a whole number of days'
  }
  if (value < floor) {
    return `Cannot be set below the floor of ${floor} days`
  }
  if (typeof ceiling === 'number' && value > ceiling) {
    return `Cannot be set above the ceiling of ${ceiling} days`
  }
  return null
}

// Writes companies/{companyId}.retention. firestore.rules independently
// validates every field against the same floors/ceilings and requires
// updatedByUid/updatedAt to match the write's own auth uid and server time -
// this client-side check exists only to give the admin an inline error
// instead of a rejected write, never as the real gate.
export async function updateCompanyRetention(companyId, values) {
  if (!companyId) throw new Error('companyId is required')
  const uid = requireUid()

  const retention = {}
  for (const field of RETENTION_FIELDS) {
    const value = Number(values?.[field.key])
    const error = retentionFieldError(field.key, value)
    if (error) throw new Error(`${field.label}: ${error}`)
    retention[field.key] = value
  }

  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    retention: {
      ...retention,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    },
  })
}

const previewRetentionCallable = httpsCallable(functions, 'previewRetention')

// Dry run: what the next sweep would delete, by tier, at either the
// company's currently saved settings (omit proposedRetention) or a set of
// values the admin has typed but not yet saved. Deletes nothing.
export async function previewRetention(companyId, proposedRetention) {
  const result = await previewRetentionCallable({ companyId, proposedRetention })
  return result.data
}

const setLegalHoldCallable = httpsCallable(functions, 'setLegalHold')
const releaseLegalHoldCallable = httpsCallable(functions, 'releaseLegalHold')
const listLegalHoldsCallable = httpsCallable(functions, 'listLegalHolds')

export async function setLegalHold(caseId, reason) {
  const result = await setLegalHoldCallable({ caseId, reason })
  return result.data
}

export async function releaseLegalHold(caseId, reason) {
  const result = await releaseLegalHoldCallable({ caseId, reason })
  return result.data
}

export async function listLegalHolds(companyId) {
  const result = await listLegalHoldsCallable({ companyId })
  return result.data.holds ?? []
}

const requestCaseDeletionCallable = httpsCallable(functions, 'requestCaseDeletion')
const approveDeletionRequestCallable = httpsCallable(functions, 'approveDeletionRequest')
const declineDeletionRequestCallable = httpsCallable(functions, 'declineDeletionRequest')

// Reporter-facing, authenticated by Case ID + passcode exactly like
// postReporterMessage - see functions/src/retention/deletionRequest.js. This
// never deletes anything itself; it only sets a pending request for a human
// to review.
export async function requestCaseDeletion(caseId, passcode) {
  const result = await requestCaseDeletionCallable({ caseId, passcode })
  return result.data
}

export async function approveDeletionRequest(caseId, reason) {
  const result = await approveDeletionRequestCallable({ caseId, reason })
  return result.data
}

export async function declineDeletionRequest(caseId, reason) {
  const result = await declineDeletionRequestCallable({ caseId, reason })
  return result.data
}

// Read-only fetch of the company doc's retention block, for pages that only
// need the current settings without the full companyService surface.
export async function getCompanyRetention(companyId) {
  const snapshot = await getDoc(doc(firestore, COMPANIES_COLLECTION, companyId))
  return snapshot.exists() ? snapshot.data() : null
}
