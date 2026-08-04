const { classifyRoleText } = require('../consistency/departmentTier')
const { normalizeDepartment } = require('./subjectSignature')

// The floor, not the default. A per-company config may raise this (a large
// company may reasonably want 10 or 20); readPatternConfig in detectPatterns.js
// clamps upward only, so no configuration value - and no test fixture - can
// take it below 5. If a signal will not fire on your test data, seed more
// employees; that is the intended way to make one appear.
const MIN_POPULATION_FLOOR = 5

// Employees whose roster entry says they are gone don't count toward "how many
// people could this signal be about". Anything else - including a missing
// status - counts as present, which is the conservative direction here only
// because over-counting the population is what would UNDER-suppress. It does
// not: an inflated population makes suppression less likely, so the exclusion
// list is kept deliberately short and explicit rather than guessed at.
const INACTIVE_STATUSES = new Set(['inactive', 'removed', 'terminated', 'archived'])

// Employee docs (src/services/employeeService.js) carry name, department,
// email and status - there is no role field on the CSV import path, so an
// employee is only tierable if a company has enriched their roster with a job
// title. That is why an untitled roster tiers everyone as 'unspecified' and
// therefore suppresses every junior/senior/manager signal outright: with no
// way to know how many managers are in a department, there is no way to know
// whether naming one is naming a person. Fail closed.
function employeeRoleTier(employee) {
  return classifyRoleText(employee?.jobTitle ?? employee?.title ?? employee?.role)
}

function isPresent(employee) {
  const status = String(employee?.status ?? '').trim().toLowerCase()
  return !INACTIVE_STATUSES.has(status)
}

// department -> roleTier -> headcount, plus the set of departments the
// directory knows about at all. The second is not derivable from the first:
// "this department has 0 managers" and "this department is not in the
// directory" are different facts and are suppressed with different reasons.
function buildPopulationIndex(employees) {
  const byDepartment = new Map()

  for (const employee of employees) {
    if (!isPresent(employee)) continue
    const department = normalizeDepartment(employee?.department)
    if (!department) continue

    if (!byDepartment.has(department)) byDepartment.set(department, new Map())
    const tiers = byDepartment.get(department)
    const tier = employeeRoleTier(employee)
    tiers.set(tier, (tiers.get(tier) ?? 0) + 1)
  }

  return byDepartment
}

const SUPPRESSED_NO_DIRECTORY_DATA = 'no_directory_data'
const SUPPRESSED_POPULATION_BELOW_MINIMUM = 'population_below_minimum'

// The single decision this module exists to make: may a group of cases be
// surfaced as a signal at all?
//
// A signal says "this department, at this role tier, has N reports". In a
// department with three managers that sentence names a person as surely as
// writing the name would - the reader simply performs the last step
// themselves. So the test is not about the cases, it is about the population
// the signal points into: if fewer than `minPopulation` people match the
// department + tier, the signal is suppressed entirely.
//
// Suppressed, not degraded. There is no coarser form of this signal that is
// safe - widening it to the whole department or dropping the tier would change
// what the signal claims while still pointing at the same small group - so the
// only safe output is nothing at all, plus a count of how many nothings there
// were (see detectPatterns.js's run summary) so an HR Coordinator is never
// left wondering whether the feature is broken.
function evaluateSuppression({ populationIndex, department, roleTier, minPopulation }) {
  const threshold = Math.max(MIN_POPULATION_FLOOR, Number(minPopulation) || 0)
  const tiers = populationIndex.get(department)

  if (!tiers) {
    return { suppressed: true, reason: SUPPRESSED_NO_DIRECTORY_DATA, population: null, threshold }
  }

  const population = tiers.get(roleTier) ?? 0
  if (population < threshold) {
    return { suppressed: true, reason: SUPPRESSED_POPULATION_BELOW_MINIMUM, population, threshold }
  }

  return { suppressed: false, reason: null, population, threshold }
}

// A cross-category signal spans several categories in one department + tier,
// so it points at the same population as its same-category siblings and is
// suppressed on exactly the same test. It gets its own entry point only so the
// caller can't accidentally skip the check for the weaker signal type.
function evaluateCrossCategorySuppression(args) {
  return evaluateSuppression(args)
}

// The exact set of keys a patternSignals document may contain. Counts, tiers,
// dates, ids - no name, no free-text excerpt, no questionnaire answer, no
// score, no reporter attribute. This runs on every write in detectPatterns.js
// rather than being a comment about what that code happens to build today, so
// a field added upstream is dropped here instead of silently reaching
// Firestore.
//
// handlerIds is on the list and is the one field here that names accounts
// rather than counts: it is what firestore.rules matches a Case Handler's uid
// against, so a handler can read the signals their own cases are in and no
// others. It says who is investigating, never who was reported - the same
// distinction that already lets caseMetadata carry assignedHandlerId.
const SIGNAL_FIELDS = [
  'companyId',
  'department',
  'roleTier',
  'category',
  'caseCount',
  'windowDays',
  'firstReportedAt',
  'lastReportedAt',
  'signalType',
  'caseIds',
  'handlerIds',
  'computedAt',
]

function redactToAllowedFields(signal) {
  const redacted = {}
  for (const field of SIGNAL_FIELDS) {
    if (signal[field] !== undefined) redacted[field] = signal[field]
  }
  return redacted
}

module.exports = {
  MIN_POPULATION_FLOOR,
  SIGNAL_FIELDS,
  SUPPRESSED_NO_DIRECTORY_DATA,
  SUPPRESSED_POPULATION_BELOW_MINIMUM,
  buildPopulationIndex,
  evaluateSuppression,
  evaluateCrossCategorySuppression,
  redactToAllowedFields,
}
