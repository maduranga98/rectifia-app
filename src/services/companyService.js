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
import { FEATURE_FLAGS } from '../config/featureFlags'

// Full set accepted by validation, including deprecated codes that an
// existing company may still be configured with. A company already saved
// as LK must be able to save its other settings without a validation
// error, even though LK is no longer offered for new selection.
export const VALID_JURISDICTIONS = ['EU', 'UK', 'US', 'AU', 'JP', 'LK']

// What the UI offers for new selection. LK is deprecated and excluded here
// while remaining in VALID_JURISDICTIONS so existing LK companies keep working.
export const SELECTABLE_JURISDICTIONS = ['EU', 'UK', 'US', 'AU', 'JP']

// Kept as an alias so existing imports of JURISDICTIONS keep resolving to
// the selectable set.
export const JURISDICTIONS = SELECTABLE_JURISDICTIONS

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

// Retaliation follow-up cadence config (companies/{companyId}.followUpConfig),
// read server-side by functions/src/followup/scheduleFollowUps.js. These
// defaults mirror DEFAULT_INTERVAL_DAYS / ALL_CATEGORIES there - the module is
// default-on for all four categories, so a company opts categories OUT rather
// than in, and an unconfigured company still gets the defaults.
export const DEFAULT_FOLLOW_UP_INTERVALS = [30, 60, 90]
export const FOLLOW_UP_CATEGORIES = ['harassment', 'toxicManagement', 'retaliation', 'burnout']

// Compliance strictness ranking, most strict first. When a company selects
// multiple jurisdictions, the default timeline is driven by whichever
// jurisdiction ranks highest here (EU's 7-day/3-month rule), until a later
// module lets a user override the timeline per-jurisdiction.
//
// This list is display-only: it drives the "strictest selected" hint shown
// on the setup/settings forms. The authoritative computation is
// getStrictestRule() in functions/src/compliance/jurisdictionRules.js,
// which is what actually schedules deadlines. The two lists must be kept in
// sync manually - there is no shared source between the client and
// functions bundles.
const JURISDICTION_STRICTNESS_ORDER = ['EU', 'JP', 'UK', 'US', 'AU', 'LK']

// Prefills companies/{companyId}.timeZone from the first jurisdiction
// selected at creation - functions/src/utils/companySchedule.js is what
// actually reads timeZone (to decide the local hour for the two per-company
// hourly sweeps), this mapping only chooses a sensible starting value. A
// prefill only: the admin can change it on SettingsPage.jsx afterwards, and
// changing jurisdictions later must never silently overwrite an explicitly
// chosen timeZone - see createCompany and updateCompanyTimeZone below.
export const DEFAULT_TIMEZONE_BY_JURISDICTION = {
  EU: 'Europe/Brussels',
  UK: 'Europe/London',
  US: 'America/New_York',
  AU: 'Australia/Sydney',
  JP: 'Asia/Tokyo',
  LK: 'Asia/Colombo',
}

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
// those selected. Does not compute or store any deadline itself - that
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
  // Optional: a Super Admin can pick a custom reporting slug on the
  // registration form instead of accepting the name-derived default. Still
  // run through allocateUniqueSlug so a manually-typed value is normalized to
  // the same URL-safe shape and checked for a platform-wide collision the
  // same way the auto-generated slug is.
  slug: requestedSlug,
}) {
  if (!name?.trim()) {
    throw new Error('Company name is required')
  }
  // Length check first: filtering an undefined jurisdictions list threw a
  // TypeError before this, which surfaced as a raw crash instead of the
  // message below.
  if (!jurisdictions?.length || jurisdictions.some((j) => !VALID_JURISDICTIONS.includes(j))) {
    throw new Error('At least one valid jurisdiction is required')
  }
  // LK persists for companies already configured with it, but must never be
  // chosen for a new company.
  if (jurisdictions.includes('LK')) {
    throw new Error('LK is deprecated and cannot be selected for a new company')
  }
  if (!SUBSCRIPTION_TIERS.includes(subscriptionTier)) {
    throw new Error('A valid subscription tier is required')
  }

  // Unique, URL-safe reporting slug allocated at creation time - this is what
  // /submit/:companySlug resolves against so anonymous reporters can file
  // against the right company without ever being handed a raw companyId.
  const slug = await allocateUniqueSlug(requestedSlug?.trim() ? requestedSlug : name)

  const docRef = await addDoc(collection(firestore, COMPANIES_COLLECTION), {
    name: name.trim(),
    slug,
    jurisdictions,
    departments,
    subscriptionTier,
    // Prefill only, from the first selected jurisdiction - the admin can
    // change it immediately on SettingsPage.jsx. null when the jurisdiction
    // has no mapped zone, which never happens today but keeps this from
    // ever writing `undefined`.
    timeZone: DEFAULT_TIMEZONE_BY_JURISDICTION[jurisdictions[0]] ?? null,
    // The Super Admin overview reads these three; seeding them at creation
    // is what stops a brand new company rendering as "Unknown"/"-" there.
    billingStatus: 'active',
    currentPeriodCaseCount: 0,
    createdAt: serverTimestamp(),
  })

  return docRef.id
}

const createCompanyAdminCallable = httpsCallable(functions, 'createCompanyAdmin')

// Creates the Company Admin account for a newly registered company and
// returns { email, password, emailDelivered } so the Super Admin can hand the
// credentials over directly. The same credentials and a login link are also
// emailed to the admin directly by createCompanyAdmin.js - emailDelivered
// reflects whether that send succeeded. The password comes back once and is
// never stored, so whatever calls this has to display it immediately.
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

// A permissive email shape check - enough to catch a typo'd address, not a
// full RFC validator (that belongs to the mail system, not a settings form).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// At least a few digits once separators/formatting are stripped; deliberately
// loose so international formats aren't rejected.
function isWellFormedPhone(phone) {
  return (phone.match(/\d/g)?.length ?? 0) >= 6
}

// Writes companies/{companyId}.crisisContact, the exact field
// functions/src/intake/routeCase.js reads in notifyCrisisContact(): a plain
// contact record { name, email, phone }, NOT a staff uid or role. A
// crisis-flagged report bypasses normal routing and notifies this person
// directly, so it may be someone with no login at all - an EAP provider or an
// external counsellor - which is exactly why it is stored as a contact record
// here rather than bound to an account.
//
// Validation mirrors the form: a name is required, and at least one of email /
// phone must be present and well-formed (a contact with no reachable channel
// notifies nobody). Both are stored when given; the reader tolerates a null
// email or phone, so an unused channel is persisted as null rather than an
// empty string. Field-scoped writes are permitted for this company's own
// Company Admin by firestore.rules (companyAdminEditableFields).
export async function updateCompanyCrisisContact(companyId, crisisContact) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  const name = String(crisisContact?.name ?? '').trim()
  const email = String(crisisContact?.email ?? '').trim()
  const phone = String(crisisContact?.phone ?? '').trim()

  if (!name) {
    throw new Error('A contact name is required')
  }
  if (!email && !phone) {
    throw new Error('Enter at least an email or a phone number for the crisis contact')
  }
  if (email && !EMAIL_RE.test(email)) {
    throw new Error('Enter a valid email address for the crisis contact')
  }
  if (phone && !isWellFormedPhone(phone)) {
    throw new Error('Enter a valid phone number for the crisis contact')
  }

  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    crisisContact: {
      name,
      email: email || null,
      phone: phone || null,
    },
  })
}

// True if `timeZone` is a value Intl (and by extension
// functions/src/utils/companySchedule.js) can actually resolve. Prefers
// Intl.supportedValuesOf('timeZone') where available (a real allowlist,
// no round-trip needed); falls back to constructing a DateTimeFormat with
// it and catching the throw on environments where supportedValuesOf isn't
// implemented. Either way, an invalid zone is rejected here rather than
// reaching the scheduler - which would silently treat it as UTC rather than
// erroring, since shouldRunForCompany's own fallback exists for a value that
// predates this validation, not as an excuse to skip validating new ones.
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      return Intl.supportedValuesOf('timeZone').includes(timeZone)
    } catch {
      // Fall through to the DateTimeFormat check below.
    }
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone })
    return true
  } catch {
    return false
  }
}

// Writes companies/{companyId}.timeZone, read by
// functions/src/utils/companySchedule.js to decide the local hour for the
// checkOverdueDeadlines and schedulePulseChecks sweeps. Rejects anything
// that doesn't validate as a real IANA zone outright - an invalid value must
// never reach the scheduler, even though shouldRunForCompany() would fall
// back to UTC rather than throw if one somehow did.
export async function updateCompanyTimeZone(companyId, timeZone) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error('Enter a valid IANA time zone, e.g. "Asia/Tokyo"')
  }
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    timeZone,
  })
}

// Writes companies/{companyId}.employeeCount - the self-declared headcount
// that is now the AUTHORITATIVE billing input across the whole app (see
// functions/src/billing/pricingEngine.js's readDeclaredEmployeeCount()
// comment): the package-selection UI (PackageSelector.jsx /
// PulseCheckToggle.jsx) reads it to show a company's matching Core/Pulse
// Check band, upgradeSubscription.js re-reads it server-side to validate a
// self-serve band selection AND to price the real Stripe subscription item,
// and calculateQuote.js/syncSubscriptionPricing.js/createCheckoutSession.js/
// togglePulseCheckAddOn.js all read it too - none of them fall back to the
// live Pulse Check roster count. This is a v1 manual entry, not derived from
// companies/{companyId}/employees, and pilot v1 has no automated
// reconciliation between the two. firestore.rules permits this field for the
// company's own Company Admin (companyAdminEditableFields), same allowlist
// pattern as timeZone above.
export async function updateCompanyEmployeeCount(companyId, employeeCount) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  const count = Number(employeeCount)
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
    throw new Error('Enter a whole number of employees, at least 1')
  }
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    employeeCount: count,
  })
}

export async function updateCompanyJurisdictions(companyId, jurisdictions) {
  const invalidJurisdictions = jurisdictions.filter(
    (j) => !VALID_JURISDICTIONS.includes(j)
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

// Writes companies/{companyId}.followUpConfig - the retaliation follow-up
// cadence and any categories the company has disabled. intervalsDays is a set
// of positive whole-day offsets from case closure; an empty list is a valid,
// explicit "no follow-ups" choice. disabledCategories must be a subset of the
// four known categories. firestore.rules permits this field for the company's
// own Company Admin (see companyAdminEditableFields); scheduleFollowUps.js
// re-normalizes whatever is stored, so a malformed value can never schedule
// something unexpected - but validating here gives the admin an error instead.
export async function updateCompanyFollowUpConfig(companyId, { intervalsDays, disabledCategories }) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  if (
    !Array.isArray(intervalsDays) ||
    intervalsDays.some((n) => !Number.isInteger(n) || n <= 0)
  ) {
    throw new Error('Follow-up intervals must be whole numbers of days greater than zero')
  }
  const disabled = Array.isArray(disabledCategories) ? disabledCategories : []
  if (disabled.some((c) => !FOLLOW_UP_CATEGORIES.includes(c))) {
    throw new Error('Unknown category in follow-up settings')
  }
  // De-duplicate and sort so what is stored round-trips cleanly to the UI.
  const intervals = [...new Set(intervalsDays)].sort((a, b) => a - b)
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    followUpConfig: { intervalsDays: intervals, disabledCategories: disabled },
  })
}

const sendPulseChecksNowCallable = httpsCallable(functions, 'sendPulseChecksNow')

// Triggers an on-demand pulse-check send for the caller's own company. Takes no
// companyId: the callable resolves it from the caller's verified auth claim
// server-side, so the client cannot aim a send at another company. Returns
// { queued } - how many invites were queued - which the caller surfaces to the
// admin. The server enforces the role (Company Admin / HR Coordinator only) and
// the one-send-per-company-per-hour limit; nothing here needs to duplicate that.
export async function sendPulseChecksNow() {
  const result = await sendPulseChecksNowCallable({})
  return result.data
}

export async function updateCompanyDepartments(companyId, departments) {
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    departments,
  })
}

// Writes one key of companies/{companyId}.featureFlags via dot-path update,
// leaving every other flag untouched - a toggle in FeatureFlagPanel.jsx
// never has to read-modify-write the whole map. Super Admin only:
// firestore.rules rejects this write from anyone else outright
// (featureFlagsFieldValid()), so the role check in the panel that calls this
// is UX, not the enforcement.
export async function updateCompanyFeatureFlag(companyId, key, value) {
  if (!companyId) {
    throw new Error('companyId is required')
  }
  if (!Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, key)) {
    throw new Error(`Unknown feature flag '${key}'`)
  }
  if (typeof value !== 'boolean') {
    throw new Error('A feature flag value must be true or false')
  }
  await updateDoc(doc(firestore, COMPANIES_COLLECTION, companyId), {
    [`featureFlags.${key}`]: value,
  })
}
