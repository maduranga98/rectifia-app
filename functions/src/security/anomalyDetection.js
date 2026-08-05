const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineInt } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid } = require('../utils/staffAuth')
const { recordControlRun } = require('./controlRunLog')
const { writeSecurityAlert, SECURITY_ALERTS_COLLECTION } = require('./securityAlerts')

if (!admin.apps.length) {
  admin.initializeApp()
}

const IDENTITY_AUDIT_COLLECTION = 'identityAccessAuditLog'
const EVIDENCE_ACCESS_LOG_COLLECTION = 'evidenceAccessLog'
const REPORT_EXPORTS_COLLECTION = 'reportExports'
const PRIVILEGED_ACTION_LOG_COLLECTION = 'privilegedActionLog'
const CASE_METADATA_COLLECTION = 'caseMetadata'
const COMPANIES_COLLECTION = 'companies'
const SUPER_ADMINS_COLLECTION = 'superAdmins'
const ANOMALY_BASELINES_COLLECTION = 'anomalyBaselines'
const CONTROL_NAME = 'anomalyDetection'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = DAY_MS

// Detection thresholds. All deploy-time config, not hardcoded, so a company
// with a genuinely large investigations team doesn't get paged every day for
// being busy - but every one of these is a trigger for a written alert, never
// for revoking anything. See the module doctring below.
const bulkEvidenceDownloadThreshold = defineInt('ANOMALY_BULK_EVIDENCE_THRESHOLD', { default: 20 })
const departmentDiversityThreshold = defineInt('ANOMALY_DEPARTMENT_THRESHOLD', { default: 4 })

// Baseline multiplier/floor shared by the two "above a learned baseline"
// checks (identity decryption, report export volume). A day's count only
// flags once it clears BOTH the multiple of the actor's own rolling average
// AND this absolute floor - the floor exists so an actor whose baseline is
// near zero doesn't flag on their second-ever action of the day.
const BASELINE_MULTIPLIER = 3
const BASELINE_MIN_ABSOLUTE = 5
// Exponential moving average smoothing - each day's observation moves the
// baseline 30% of the way toward itself, so the baseline adapts to a
// genuinely busier role over a couple of weeks without one anomalous day
// permanently inflating "normal".
const BASELINE_ALPHA = 0.3

// Detection only. This module has no revoke, no deactivate, no lock-out path
// anywhere in it, and none should ever be added: a false positive that locks
// an investigator out mid-investigation is worse than the alert it would
// have replaced. Every finding below becomes a securityAlerts row a human
// reads and acts on - or doesn't - never an automated consequence.

function toMillis(value) {
  return typeof value?.toMillis === 'function' ? value.toMillis() : null
}

// Updates a rolling per-key baseline (EMA) and reports whether today's count
// clears it. `key` is any string that identifies the thing being baselined,
// e.g. `identityDecrypt:{uid}` or `reportExport:{companyId}`. Returns
// { flagged, baselineBefore } - flagged is always false the first time a key
// is seen, since there is nothing yet to compare against.
async function updateBaselineAndCheck(firestore, key, todayCount) {
  const ref = firestore.collection(ANOMALY_BASELINES_COLLECTION).doc(key)
  const snap = await ref.get()
  const baselineBefore = snap.exists ? Number(snap.data().avg) : null

  const flagged =
    baselineBefore !== null && todayCount > Math.max(baselineBefore * BASELINE_MULTIPLIER, BASELINE_MIN_ABSOLUTE)

  const newAvg =
    baselineBefore === null ? todayCount : BASELINE_ALPHA * todayCount + (1 - BASELINE_ALPHA) * baselineBefore

  await ref.set(
    {
      key,
      avg: newAvg,
      samples: admin.firestore.FieldValue.increment(1),
      lastCount: todayCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  return { flagged, baselineBefore }
}

// Resolves a caseId to its companyId via the caseMetadata mirror (metadata
// only - never reads cases/{caseId} itself). identityAccessAuditLog entries
// carry a caseId but not a companyId (see identityVault.js's writeAuditEntry
// - that log's whole shape is who/when/case/reason, no company field), so an
// alert about it has to make this one extra hop to be filterable by company
// on the dashboard.
async function companyIdForCase(firestore, caseId, cache) {
  if (!caseId) return null
  if (cache.has(caseId)) return cache.get(caseId)
  const snap = await firestore.collection(CASE_METADATA_COLLECTION).doc(caseId).get()
  const companyId = snap.exists ? snap.data().companyId ?? null : null
  cache.set(caseId, companyId)
  return companyId
}

function groupBy(items, keyFn) {
  const map = new Map()
  for (const item of items) {
    const key = keyFn(item)
    if (key === null || key === undefined) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return map
}

// Check 1: identity decryptions above a per-handler baseline.
async function checkIdentityDecryptions(firestore, windowStart) {
  const snapshot = await firestore
    .collection(IDENTITY_AUDIT_COLLECTION)
    .where('at', '>=', windowStart)
    .get()

  const grants = snapshot.docs
    .map((d) => d.data())
    .filter((d) => d.outcome === 'granted' && d.action === 'staff_reveal' && d.actorUid)

  const byActor = groupBy(grants, (d) => d.actorUid)
  const caseCompanyCache = new Map()
  let flaggedCount = 0

  for (const [actorUid, entries] of byActor) {
    const { flagged, baselineBefore } = await updateBaselineAndCheck(
      firestore,
      `identityDecrypt:${actorUid}`,
      entries.length
    )
    if (flagged) {
      flaggedCount += 1
      const companyId = await companyIdForCase(firestore, entries[0]?.caseId, caseCompanyCache)
      await writeSecurityAlert(firestore, {
        type: 'identity_decrypt_above_baseline',
        actorUid,
        companyId,
        severity: 'medium',
        summary: `${entries.length} identity decryption(s) in 24h, baseline ~${baselineBefore.toFixed(1)}`,
        metric: { count: entries.length, baseline: baselineBefore },
      })
    }
  }
  return { actorsSeen: byActor.size, flaggedCount }
}

// Check 2: evidence downloads in bulk (absolute threshold, not a baseline -
// a reporter's or handler's evidence download volume is naturally spiky
// case-by-case, so "bulk in one day" is the meaningful signal here, not a
// deviation from a personal average).
async function checkBulkEvidenceDownloads(firestore, windowStart) {
  const snapshot = await firestore
    .collection(EVIDENCE_ACCESS_LOG_COLLECTION)
    .where('at', '>=', windowStart)
    .get()

  const downloads = snapshot.docs
    .map((d) => d.data())
    .filter((d) => d.outcome === 'granted' && d.action === 'download_url_issued' && d.actor && d.actor !== 'reporter')

  const byActor = groupBy(downloads, (d) => d.actor)
  const threshold = bulkEvidenceDownloadThreshold.value()
  let flaggedCount = 0

  for (const [actor, entries] of byActor) {
    if (entries.length <= threshold) continue
    flaggedCount += 1
    await writeSecurityAlert(firestore, {
      type: 'bulk_evidence_download',
      actorUid: actor,
      companyId: entries[0]?.companyId ?? null,
      severity: 'medium',
      summary: `${entries.length} evidence downloads in 24h, threshold ${threshold}`,
      metric: { count: entries.length, threshold },
    })
  }
  return { actorsSeen: byActor.size, flaggedCount }
}

// Check 3: report exports at unusual volume, per company (a company-wide
// baseline rather than per-actor - report exports are rarer than evidence
// downloads and usually span a small handler roster, so per-actor baselines
// would mostly be learning noise).
async function checkReportExportVolume(firestore, windowStart) {
  const snapshot = await firestore
    .collection(REPORT_EXPORTS_COLLECTION)
    .where('exportedAt', '>=', windowStart)
    .get()

  const exports_ = snapshot.docs.map((d) => d.data())
  const byCompany = groupBy(exports_, (d) => d.companyId)
  let flaggedCount = 0

  for (const [companyId, entries] of byCompany) {
    const { flagged, baselineBefore } = await updateBaselineAndCheck(
      firestore,
      `reportExport:${companyId}`,
      entries.length
    )
    if (flagged) {
      flaggedCount += 1
      await writeSecurityAlert(firestore, {
        type: 'report_export_above_baseline',
        companyId,
        severity: 'low',
        summary: `${entries.length} report exports in 24h, baseline ~${baselineBefore.toFixed(1)}`,
        metric: { count: entries.length, baseline: baselineBefore },
      })
    }
  }
  return { companiesSeen: byCompany.size, flaggedCount }
}

// A company's working hours, read from an optional `workingHours` field on
// its company doc ({ startHour, endHour, utcOffsetMinutes, days: [0-6] }).
// No settings page writes this field yet - it's a documented extension point
// (see docs/controls/logging-monitoring.md), and every company works off the
// same conservative default until one is configured: 08:00-19:00, Mon-Fri,
// UTC. A default that is too narrow produces false positives a human can
// dismiss; treating every hour as "working hours" would produce this check
// silently forever, which is the wrong failure mode for a detective control.
const DEFAULT_WORKING_HOURS = { startHour: 8, endHour: 19, utcOffsetMinutes: 0, days: [1, 2, 3, 4, 5] }

function isOutsideWorkingHours(atMs, workingHours) {
  const local = new Date(atMs + workingHours.utcOffsetMinutes * 60 * 1000)
  const day = local.getUTCDay()
  const hour = local.getUTCHours()
  if (!workingHours.days.includes(day)) return true
  return hour < workingHours.startHour || hour >= workingHours.endHour
}

// Check 4: access outside a company's configured working hours, and
// Check 5: a staff account touching cases across an unusual number of
// departments - both driven off privilegedActionLog, module 26's chokepoint-
// level trail of every privileged action (see functions/src/utils/staffAuth.js),
// since it is the one collection with companyId + actorUid + caseId + a
// timestamp on essentially every granted call.
async function checkOffHoursAndDepartmentSpread(firestore, windowStart) {
  const snapshot = await firestore
    .collection(PRIVILEGED_ACTION_LOG_COLLECTION)
    .where('at', '>=', windowStart)
    .get()

  const grants = snapshot.docs
    .map((d) => d.data())
    .filter((d) => d.outcome === 'granted' && d.uid && d.companyId)

  const companyCache = new Map()
  async function workingHoursFor(companyId) {
    if (companyCache.has(companyId)) return companyCache.get(companyId)
    const snap = await firestore.collection(COMPANIES_COLLECTION).doc(companyId).get()
    const configured = snap.exists ? snap.data().workingHours : null
    const resolved =
      configured && Number.isFinite(configured.startHour) && Number.isFinite(configured.endHour)
        ? { ...DEFAULT_WORKING_HOURS, ...configured }
        : DEFAULT_WORKING_HOURS
    companyCache.set(companyId, resolved)
    return resolved
  }

  // Off-hours: group by (companyId, uid), count entries outside that
  // company's working hours, alert once per actor per day rather than once
  // per event.
  const byActorCompany = groupBy(grants, (d) => `${d.companyId}::${d.uid}`)
  let offHoursFlagged = 0
  for (const [key, entries] of byActorCompany) {
    const [companyId, uid] = key.split('::')
    // eslint-disable-next-line no-await-in-loop
    const hours = await workingHoursFor(companyId)
    const offHoursEntries = entries.filter((e) => isOutsideWorkingHours(toMillis(e.at) ?? Date.now(), hours))
    if (offHoursEntries.length === 0) continue
    offHoursFlagged += 1
    // eslint-disable-next-line no-await-in-loop
    await writeSecurityAlert(firestore, {
      type: 'off_hours_access',
      companyId,
      actorUid: uid,
      severity: 'low',
      summary: `${offHoursEntries.length} privileged action(s) outside configured working hours in 24h`,
      metric: { count: offHoursEntries.length, totalInWindow: entries.length },
    })
  }

  // Department spread: group by uid across ALL companies in the window
  // (a staff account only ever belongs to one company, so this is really
  // per-company already), resolve each distinct caseId to a department via
  // caseMetadata, count distinct departments touched.
  const byActor = groupBy(
    grants.filter((d) => d.caseId),
    (d) => d.uid
  )
  let departmentFlagged = 0
  const threshold = departmentDiversityThreshold.value()

  for (const [uid, entries] of byActor) {
    const distinctCaseIds = [...new Set(entries.map((e) => e.caseId))]
    const departments = new Set()
    for (const caseId of distinctCaseIds) {
      // eslint-disable-next-line no-await-in-loop
      const metaSnap = await firestore.collection(CASE_METADATA_COLLECTION).doc(caseId).get()
      const department = metaSnap.exists ? metaSnap.data().department : null
      if (department) departments.add(department)
    }
    if (departments.size <= threshold) continue
    departmentFlagged += 1
    // eslint-disable-next-line no-await-in-loop
    await writeSecurityAlert(firestore, {
      type: 'unusual_department_spread',
      companyId: entries[0]?.companyId ?? null,
      actorUid: uid,
      severity: 'medium',
      summary: `Touched cases in ${departments.size} distinct departments in 24h, threshold ${threshold}`,
      metric: { departmentCount: departments.size, threshold, caseCount: distinctCaseIds.length },
    })
  }

  return { offHoursFlagged, departmentFlagged, actorsSeen: byActorCompany.size }
}

// Runs daily. Every check below writes zero or more securityAlerts rows and
// this function always writes one securityControlRuns row, whether or not
// any check found anything - see controlRunLog.js.
exports.anomalyDetection = onSchedule('every day 05:00', async () => {
  const firestore = admin.firestore()
  const windowStart = admin.firestore.Timestamp.fromMillis(Date.now() - WINDOW_MS)

  const results = {}
  let failures = 0

  const checks = [
    ['identityDecryptions', checkIdentityDecryptions],
    ['bulkEvidenceDownloads', checkBulkEvidenceDownloads],
    ['reportExportVolume', checkReportExportVolume],
    ['offHoursAndDepartmentSpread', checkOffHoursAndDepartmentSpread],
  ]

  for (const [name, fn] of checks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      results[name] = await fn(firestore, windowStart)
    } catch (err) {
      failures += 1
      logger.error('anomalyDetection: check failed', { check: name, error: err.message })
    }
  }

  await recordControlRun(firestore, {
    control: CONTROL_NAME,
    outcome: failures === 0 ? 'ok' : 'partial_failure',
    summary: { windowHours: WINDOW_MS / (60 * 60 * 1000), results, failures },
  })
})

async function isSuperAdmin(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

// Marks an alert reviewed. This is the one mutation this module makes to its
// own findings, and it is deliberately narrow: it records that a human looked
// at the alert and what they concluded, never that anything about the
// account or case itself changed. Still advisory, still no revoke.
exports.reviewSecurityAlert = onCall(async (request) => {
  const uid = requireAuthUid(request)
  const { alertId, note } = request.data || {}
  const firestore = admin.firestore()

  if (!(await isSuperAdmin(firestore, uid))) {
    throw new HttpsError('permission-denied', 'Only a Super Admin may review security alerts')
  }
  if (typeof alertId !== 'string' || !alertId) {
    throw new HttpsError('invalid-argument', 'alertId is required')
  }

  const ref = firestore.collection(SECURITY_ALERTS_COLLECTION).doc(alertId)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No such alert')
  }

  await ref.update({
    status: 'reviewed',
    reviewedByUid: uid,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewNote: typeof note === 'string' ? note.slice(0, 500) : null,
  })

  return { status: 'reviewed' }
})
