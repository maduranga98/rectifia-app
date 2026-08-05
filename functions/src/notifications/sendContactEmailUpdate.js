const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineString } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')
const { encryptionKeySecret, decryptIdentity } = require('../utils/identityVault')
const { sendMail, smtpPassword } = require('../utils/email')
const { DECOY_TEMPLATES } = require('./decoyTemplates')

if (!admin.apps.length) {
  admin.initializeApp()
}

const CASES_COLLECTION = 'cases'

// The bare app origin, and nothing else, is the only link this email ever
// carries. Same deploy-time param deliverNotifications.js reads.
const appBaseUrl = defineString('APP_BASE_URL', { default: 'https://rectifia-59a1e.web.app' })

// The email transport for reporter case updates. It is the second transport on
// the SAME decoy pool the push path uses (./decoyTemplates.js) - one pool, two
// transports. A separate template set for email would drift, and the moment the
// two drifted an observer could tell which channel a reporter had chosen from
// the wording alone.
//
// What this email may contain is the strictest content rule in the system,
// because unlike a push notification it lands in a mailbox that is backed up,
// synced, indexed by the provider, and potentially readable by an employer's
// mail administrator if the reporter used a work address. So: no case
// reference, no Case ID, no category, no status, no message text, and no deep
// link that encodes any of those. The reporter opens their own case with the
// credentials they already hold, from the plain origin below.
//
// There is deliberately no unsubscribe link either - a one-click unsubscribe
// URL is a case-scoped token in an inbox, which is exactly the kind of durable
// case identifier this whole design avoids. Withdrawal happens inside the case
// view, through removeContactEmail (functions/src/intake/identityTransition.js),
// which deletes the address rather than flagging it.

// Same rotation and same exclusion rule as sendCaseUpdate.js's pickTemplate:
// never the template this case was last sent, so two consecutive notifications
// are never identical. Tracked per case as contactEmailLastTemplateId, which
// sits beside the address it belongs to and is deleted with it.
function pickTemplate(lastTemplateId) {
  const pool = DECOY_TEMPLATES.filter((t) => t.id !== lastTemplateId)
  return pool[Math.floor(Math.random() * pool.length)]
}

function buildBody(template) {
  return [template.body, '', appBaseUrl.value()].join('\n')
}

// Sends one update email for a case, if that case has a contact address on
// file. Returns { delivered, reason } and never throws for the ordinary "no
// address" case - a reporter who never added one, or removed the one they had,
// is not an error condition.
//
// Exported separately from the callable below so any code path that today
// calls sendCaseUpdate can call this alongside it and fan one update out to
// both transports without going back through an HTTPS hop.
//
// The decrypt goes through the vault like every other decrypt in the system,
// with authorizedAs 'systemNotificationDelivery' and its own action label. That
// means each delivery writes an identityAccessAuditLog entry, which is the
// intended cost: an automated read of a reporter's address is still a read of
// a reporter's address, and the log is what lets anyone later verify that the
// only thing ever done with the mapping was send a content-free email to it.
async function deliverContactEmailUpdate(firestore, caseId) {
  const snapshot = await firestore.collection(CASES_COLLECTION).doc(caseId).get()
  if (!snapshot.exists) {
    return { delivered: false, reason: 'no_case' }
  }

  const caseData = snapshot.data()
  const envelope = caseData.contactEmail?.vault ?? null
  if (!envelope) {
    return { delivered: false, reason: 'no_contact_email' }
  }

  const address = await decryptIdentity({
    envelope,
    authorizedAs: 'systemNotificationDelivery',
    actorUid: null,
    actorEmail: null,
    reason: 'Automated delivery of a content-free case update to the address the reporter supplied',
    caseId,
    field: 'contactEmail',
    action: 'contact_email_delivery',
    firestore,
  })

  const template = pickTemplate(caseData.contactEmailLastTemplateId)

  try {
    await sendMail({
      to: address,
      subject: template.subject,
      text: buildBody(template),
      html: null,
    })
  } catch (err) {
    // Identifiers only - never the address, never the body.
    logger.error('sendContactEmailUpdate: send failed', { caseId, error: err.message })
    return { delivered: false, reason: 'send_failed' }
  }

  await snapshot.ref.update({
    contactEmailLastTemplateId: template.id,
    contactEmailLastSentAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { delivered: true }
}

// Staff-invoked, gated exactly as sendCaseUpdate is: the caller presents a
// Firebase Auth token and loadCaseForHandler verifies from the server-side
// staff record that they are the handler this case is assigned to. Without
// that, anyone who guessed a Case ID could make us mail the reporter, which is
// both a spam channel and a way to probe whether an address is on file.
//
// The handler learns nothing from the result but whether something was
// delivered. The address is not returned, not logged, and not written anywhere
// they can read.
exports.sendContactEmailUpdate = onCall(
  { secrets: [encryptionKeySecret, smtpPassword] },
  async (request) => {
    const uid = requireAuthUid(request)
    const { caseId } = request.data || {}
    if (!caseId) {
      throw new HttpsError('invalid-argument', 'caseId is required')
    }

    const firestore = admin.firestore()
    await loadCaseForHandler(firestore, caseId, uid)

    return deliverContactEmailUpdate(firestore, caseId)
  }
)

exports.deliverContactEmailUpdate = deliverContactEmailUpdate
