const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')
const {
  CATEGORIES,
  INDUSTRIES,
  SIZE_BANDS,
  isKnownIndustry,
  bandForEmployeeCount,
  cellId,
} = require('./benchmarkThresholds')
const { recomputeAllCells } = require('./computeBenchmarks')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const BENCHMARK_CELLS_COLLECTION = 'benchmarkCells'
const BENCHMARK_OPT_INS_COLLECTION = 'benchmarkOptIns'
const BENCHMARK_OPT_IN_HISTORY_SUBCOLLECTION = 'history'

// Only a Company Admin may set or withdraw an opt-in. This is the same posture
// jurisdictions and pulseCheckCadence sit at - "settings about the company"
// belong to the role whose whole surface is settings and structure. The read
// side is different, and deliberately wider: any staff of the company can
// pull the comparison against their own cell, because reading a cell that
// this company also fed does not disclose anything the pool as a whole does
// not already disclose.
const OPT_IN_ROLES = ['companyAdmin']

// getBenchmarksForCompany
//
// Returns the four category cells matching this company's own industry and
// size band, one per case category, and only if the company is currently
// opted in. Reading requires contributing - a pool that can be read without
// contributing collapses into a one-way intelligence product and every
// company opts out of contributing.
//
// Any staff role of the company may call this. The comparison is the point
// of the feature for the HR Coordinator and the Company Admin alike, and the
// only thing that leaves the caller's boundary here is the same aggregate
// cell every other opted-in company can read - it doesn't name anyone and
// it doesn't attribute anything to a company, including their own.
exports.getBenchmarksForCompany = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  // The company is read off the caller's verified custom claim - never from
  // a client-supplied field - so a staff account cannot aim this at another
  // company's cell. A companyId in request.data is accepted purely as an
  // assertion the caller must match, not as a target selector.
  const companyId = request.auth?.token?.companyId
  if (!companyId || (request.data?.companyId && request.data.companyId !== companyId)) {
    throw new HttpsError('permission-denied', 'You may only read your own company\'s benchmarks')
  }
  // Membership verified against the staff subcollection, not the claim alone -
  // a stale claim on a deactivated account still fails.
  const role = await loadCallerRole(firestore, companyId, uid, 'benchmark_read')
  await logPrivilegedAction(firestore, { uid, companyId, role, action: 'benchmark_read', outcome: 'granted' })

  const [companySnap, optInSnap] = await Promise.all([
    firestore.collection(COMPANIES_COLLECTION).doc(companyId).get(),
    firestore.collection(BENCHMARK_OPT_INS_COLLECTION).doc(companyId).get(),
  ])
  if (!companySnap.exists) {
    throw new HttpsError('not-found', 'Company not found')
  }

  const optIn = optInSnap.exists ? optInSnap.data() : null
  if (!optIn || optIn.optedIn !== true) {
    return {
      optedIn: false,
      cells: [],
      // The industry and band the company would occupy if it opted in - so
      // the UI can show what cell the caller is asking to see before they
      // agree to contribute.
      industry: optIn?.industry ?? null,
      sizeBand: optIn ? bandForEmployeeCount(optIn.employeeCount) : null,
    }
  }

  const industry = optIn.industry
  const sizeBand = bandForEmployeeCount(optIn.employeeCount)
  if (!isKnownIndustry(industry) || !sizeBand) {
    // The opt-in doc is marked optedIn but its industry/employeeCount no
    // longer places the company into a valid cell - the previous run treated
    // it as not participating (loadOptedInCompanies drops the same row), so
    // there is nothing to read. Say so plainly rather than returning empty
    // cells that look like an unpopulated pool.
    return { optedIn: true, cells: [], industry: industry ?? null, sizeBand: null, incomplete: true }
  }

  // One document per category. Load them by exact id rather than a query -
  // benchmarkCells is keyed by cellId, so this is four point reads, not a
  // scan, and it never lists another company's cell.
  const ids = CATEGORIES.map((category) => cellId(industry, sizeBand, category))
  const snapshots = await firestore.getAll(
    ...ids.map((id) => firestore.collection(BENCHMARK_CELLS_COLLECTION).doc(id))
  )
  const cells = snapshots.map((snap) => (snap.exists ? snap.data() : null)).filter(Boolean)

  return {
    optedIn: true,
    industry,
    sizeBand,
    cells,
  }
})

// setBenchmarkOptIn
//
// The Company Admin's opt-in and withdrawal control. Writes:
//   - optedIn (boolean)
//   - industry, employeeCount (the two facts a cell coordinate needs)
//   - acknowledged (the caller confirms they have read what is and is not
//     shared - a required flag, not a checkbox for show)
//   - actor uid + server timestamp on every write, plus a history subcollection
//     entry so the record of who opted in or out is append-only rather than
//     the last-writer's word for it.
//
// The industry and employeeCount live on the opt-in doc rather than the
// company doc so the acknowledgement text and the two facts move together -
// changing employee count from 400 to 4,000 is enough of a shift to move the
// company to a different size band and read/contribute to a different cell,
// and that should be an explicit re-consent, not a settings edit somewhere
// else that silently reroutes their contribution.
exports.setBenchmarkOptIn = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  const companyId = request.auth?.token?.companyId
  if (!companyId || (request.data?.companyId && request.data.companyId !== companyId)) {
    throw new HttpsError(
      'permission-denied',
      'You may only change your own company\'s benchmark opt-in'
    )
  }
  const role = await loadCallerRole(firestore, companyId, uid, 'benchmark_opt_in_change')
  if (!OPT_IN_ROLES.includes(role)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action: 'benchmark_opt_in_change',
      outcome: 'denied:permission-denied',
      detail: 'role_not_company_admin',
    })
    throw new HttpsError(
      'permission-denied',
      'Only a Company Admin may change benchmark opt-in'
    )
  }
  await logPrivilegedAction(firestore, {
    uid,
    companyId,
    role,
    action: 'benchmark_opt_in_change',
    outcome: 'granted',
  })

  const optedIn = request.data?.optedIn === true
  const acknowledged = request.data?.acknowledged === true

  // The acknowledgement gate is required even on opt-out: withdrawing is
  // consequential too (a cell that was above threshold with this company may
  // fall below it on the next run, going dark for every other reader), and
  // the same "read what this changes" screen carries both directions. What
  // exactly is being acknowledged is documented in the client (BenchmarkPage
  // .jsx) - a flag here says only that the acknowledgement happened.
  if (!acknowledged) {
    throw new HttpsError(
      'failed-precondition',
      'You must acknowledge the description of what is and is not shared before changing opt-in'
    )
  }

  let industry = null
  let employeeCount = null
  if (optedIn) {
    industry = request.data?.industry
    employeeCount = Number(request.data?.employeeCount)
    if (!isKnownIndustry(industry)) {
      throw new HttpsError(
        'invalid-argument',
        'Choose an industry from the list before opting in'
      )
    }
    if (!Number.isFinite(employeeCount) || !bandForEmployeeCount(employeeCount)) {
      throw new HttpsError(
        'invalid-argument',
        'Enter an employee count that falls inside one of the size bands'
      )
    }
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const optInRef = firestore.collection(BENCHMARK_OPT_INS_COLLECTION).doc(companyId)

  // Two writes in a batch: the current-state doc (overwrites the previous
  // opt-in state atomically) and an append-only history entry that records
  // who did what when. The history subcollection is Admin-SDK-write-only per
  // firestore.rules, so this callable is the only path that can append.
  const batch = firestore.batch()
  batch.set(optInRef, {
    companyId,
    optedIn,
    industry: optedIn ? industry : null,
    employeeCount: optedIn ? employeeCount : null,
    acknowledgedAt: now,
    actorUid: uid,
    updatedAt: now,
  })
  const historyRef = optInRef.collection(BENCHMARK_OPT_IN_HISTORY_SUBCOLLECTION).doc()
  batch.set(historyRef, {
    action: optedIn ? 'opt_in' : 'opt_out',
    actorUid: uid,
    industry: optedIn ? industry : null,
    employeeCount: optedIn ? employeeCount : null,
    acknowledged: true,
    at: now,
  })

  await batch.commit()

  logger.info('setBenchmarkOptIn: updated', {
    companyId,
    optedIn,
    industry,
    employeeCount,
    actorUid: uid,
  })

  // On the first opt-in a company would otherwise wait until the next monthly
  // run to see their own comparison populate. That is a bad first impression
  // for an opt-in feature, and it is safe to trigger a run on demand precisely
  // because withdrawal has the same immediate effect - both directions
  // recompute over the current opted-in set. A recompute is idempotent and
  // publishes only cells that clear both k-thresholds, so a single new
  // participant contributing to a small industry does not suddenly reveal
  // more cells than the thresholds allow.
  if (optedIn) {
    try {
      await recomputeAllCells(firestore, Date.now())
    } catch (error) {
      // The opt-in itself already committed - the state is correct, only the
      // eager recompute failed. Log and let the next scheduled run pick it up.
      logger.error('setBenchmarkOptIn: eager recompute failed', {
        companyId,
        error: error.message,
      })
    }
  }

  return { optedIn, industry, employeeCount }
})

// The catalog the Company Admin's opt-in form needs. Returning it from a
// callable rather than shipping the arrays to the client keeps the industries
// and bands defined in one place - the server - so a future addition here
// takes effect without a coordinated client release.
exports.getBenchmarkCatalog = onCall(async (request) => {
  requireAuthUid(request)
  return {
    industries: INDUSTRIES,
    sizeBands: SIZE_BANDS,
    categories: CATEGORIES,
  }
})
