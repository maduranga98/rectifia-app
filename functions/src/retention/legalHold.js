const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAuthUid, loadCallerRole, logPrivilegedAction } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'
const SUPER_ADMINS_COLLECTION = 'superAdmins'
const DELETION_LOG_COLLECTION = 'deletionLog'
const MIN_REASON_LENGTH = 10

// Super Admin is superAdmins/{uid} allowlist membership, not a custom claim -
// same check functions/src/investigation/revealIdentity.js uses, done here
// with the Admin SDK so it bypasses the (deny-all) client rule on that
// collection.
async function isSuperAdmin(firestore, uid) {
  const snapshot = await firestore.collection(SUPER_ADMINS_COLLECTION).doc(uid).get()
  return snapshot.exists
}

// A legal hold is a company-admin-or-higher action, deliberately narrower
// than the case-handler roles that can act on a case's investigation
// (functions/src/utils/staffAuth.js's HANDLER_ROLES) - deciding to freeze a
// case against every retention sweep is a company-level legal decision, not
// an investigation step, and it should not require being the assigned
// handler to place or lift.
async function loadCaseForHoldManagement(firestore, request, caseId, action) {
  const uid = requireAuthUid(request)
  if (typeof caseId !== 'string' || !caseId) {
    throw new HttpsError('invalid-argument', 'caseId is required')
  }

  const caseRef = firestore.collection(CASES_COLLECTION).doc(caseId)
  const snapshot = await caseRef.get()
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'No such case')
  }
  const caseData = snapshot.data()

  if (await isSuperAdmin(firestore, uid)) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: caseData.companyId ?? null,
      role: 'superAdmin',
      action,
      outcome: 'granted',
      caseId,
    })
    return { uid, caseRef, caseData }
  }

  const companyId = request.auth?.token?.companyId
  if (!companyId || companyId !== caseData.companyId) {
    await logPrivilegedAction(firestore, {
      uid,
      companyId: companyId ?? null,
      role: null,
      action,
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'wrong_company',
    })
    throw new HttpsError('permission-denied', 'This case belongs to another company')
  }
  const role = await loadCallerRole(firestore, companyId, uid, action)
  if (role !== 'companyAdmin') {
    await logPrivilegedAction(firestore, {
      uid,
      companyId,
      role,
      action,
      outcome: 'denied:permission-denied',
      caseId,
      detail: 'role_not_company_admin',
    })
    throw new HttpsError('permission-denied', 'Only a Company Admin or Super Admin may manage legal holds')
  }
  await logPrivilegedAction(firestore, { uid, companyId, role, action, outcome: 'granted', caseId })
  return { uid, caseRef, caseData }
}

function requireReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `A documented reason of at least ${MIN_REASON_LENGTH} characters is required`
    )
  }
  return reason.trim()
}

async function writeDeletionLog(firestore, entry) {
  await firestore.collection(DELETION_LOG_COLLECTION).add({
    ...entry,
    occurredAt: admin.firestore.FieldValue.serverTimestamp(),
  })
}

// Places a case on legal hold. A held case is skipped by every retention
// sweep in functions/src/retention/applyRetention.js, including Tier 1 -
// litigation freezes identity data too, not just case content, since a
// reporter's identity can itself be evidence in a dispute.
exports.setLegalHold = onCall(async (request) => {
  const { caseId, reason } = request.data || {}
  const firestore = admin.firestore()
  const { uid, caseRef, caseData } = await loadCaseForHoldManagement(firestore, request, caseId, 'legal_hold_set')
  const cleanReason = requireReason(reason)

  if (caseData.legalHold?.active === true) {
    throw new HttpsError('failed-precondition', 'This case is already on legal hold')
  }

  const setAt = admin.firestore.FieldValue.serverTimestamp()
  await caseRef.update({
    legalHold: { active: true, reason: cleanReason, setByUid: uid, setAt },
  })
  await writeDeletionLog(firestore, {
    companyId: caseData.companyId ?? null,
    caseId,
    action: 'hold_set',
    actorUid: uid,
    reason: cleanReason,
    itemCounts: { messages: 0, evidenceObjects: 0 },
  })

  return { active: true }
})

// Releases a legal hold. This does not delete anything by itself - it only
// makes the case reachable by the next scheduled sweep again, on whatever
// clock its closedAt already puts it on. A hold that could be released
// without a record is not a hold, so this writes to deletionLog exactly like
// setLegalHold does, with its own reason.
exports.releaseLegalHold = onCall(async (request) => {
  const { caseId, reason } = request.data || {}
  const firestore = admin.firestore()
  const { uid, caseRef, caseData } = await loadCaseForHoldManagement(firestore, request, caseId, 'legal_hold_release')
  const cleanReason = requireReason(reason)

  if (caseData.legalHold?.active !== true) {
    throw new HttpsError('failed-precondition', 'This case is not currently on legal hold')
  }

  const setAt = admin.firestore.FieldValue.serverTimestamp()
  await caseRef.update({
    legalHold: { active: false, reason: cleanReason, setByUid: uid, setAt },
  })
  await writeDeletionLog(firestore, {
    companyId: caseData.companyId ?? null,
    caseId,
    action: 'hold_released',
    actorUid: uid,
    reason: cleanReason,
    itemCounts: { messages: 0, evidenceObjects: 0 },
  })

  return { active: false }
})

// Lists every case currently on legal hold for a company, for
// RetentionPage.jsx. Company Admin has no rules path to cases/{caseId} at
// all (module 2's no-case-content-access design), so this callable is the
// only way that role sees a hold list - and it is scoped tightly to exactly
// what a hold list needs: caseId, reason, who set it and when. No category,
// no status, no narrative, no identity - a legal hold's existence and reason
// are administrative facts about the case, not the case's content.
exports.listLegalHolds = onCall(async (request) => {
  const { companyId } = request.data || {}
  const uid = requireAuthUid(request)
  const firestore = admin.firestore()

  if (typeof companyId !== 'string' || !companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required')
  }

  if (!(await isSuperAdmin(firestore, uid))) {
    const tokenCompanyId = request.auth?.token?.companyId
    if (!tokenCompanyId || tokenCompanyId !== companyId) {
      throw new HttpsError('permission-denied', 'You may only view legal holds for your own company')
    }
    const role = await loadCallerRole(firestore, companyId, uid, 'list_legal_holds')
    if (role !== 'companyAdmin') {
      await logPrivilegedAction(firestore, {
        uid,
        companyId,
        role,
        action: 'list_legal_holds',
        outcome: 'denied:permission-denied',
        detail: 'role_not_company_admin',
      })
      throw new HttpsError('permission-denied', 'Only a Company Admin or Super Admin may view legal holds')
    }
    await logPrivilegedAction(firestore, { uid, companyId, role, action: 'list_legal_holds', outcome: 'granted' })
  }

  const snapshot = await firestore
    .collection(CASES_COLLECTION)
    .where('companyId', '==', companyId)
    .where('legalHold.active', '==', true)
    .get()

  const holds = snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      caseId: doc.id,
      reason: data.legalHold?.reason ?? null,
      setByUid: data.legalHold?.setByUid ?? null,
      setAt: data.legalHold?.setAt?.toMillis?.() ?? null,
    }
  })

  return { holds }
})
