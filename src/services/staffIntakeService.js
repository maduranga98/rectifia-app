import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

const createCaseOnBehalfCallable = httpsCallable(functions, 'createCaseOnBehalf')

// How a report that didn't come through the web form reached the company.
// Mirrors INTAKE_METHODS in functions/src/intake/submitCase.js, minus 'web' -
// a report the reporter filed themselves is not one filed on their behalf,
// and the callable rejects it.
//
// 'phone' is a staff member writing down a phone conversation. There is no
// recording, no voicemail capture, and no transcription anywhere in this
// flow - an oral reporting channel is a separate piece of work with its own
// consent and retention questions.
export const INTAKE_METHODS = [
  {
    value: 'phone',
    label: 'Phone call',
    description: 'You spoke with the reporter and are typing up the conversation.',
  },
  {
    value: 'email',
    label: 'Email',
    description: 'The report arrived in writing, by email or an internal message.',
  },
  {
    value: 'in_person',
    label: 'In person',
    description: 'The reporter came to you directly and described what happened.',
  },
  {
    value: 'manager_referral',
    label: 'Manager referral',
    description: 'A manager passed on a concern raised with them by someone on their team.',
  },
]

// The two tiers, in the words a reporter is actually told them in. This copy
// is shared with the reporter's own flow (src/pages/Submit.jsx) on purpose:
// the staff member reads it aloud, and the reporter's answer is only
// meaningful if it was the same question.
export const TIERS = [
  {
    value: 'anonymous',
    label: 'Anonymous',
    summary: 'Nobody can ever identify the reporter.',
    detail:
      'No name or contact details are recorded anywhere - not encrypted, not stored blank, simply never captured. Nobody at the company, at Rectifia, or with a court order can look them up afterwards. The trade-off is real: some investigations are harder to complete when the investigator cannot go back to the reporter for detail, and some cannot be substantiated at all.',
  },
  {
    value: 'confidential',
    label: 'Confidential',
    summary: 'Only the assigned investigator sees who the reporter is.',
    detail:
      'Their identity is encrypted before it is stored and is not visible on any dashboard, in any report, or to anyone else in the company. The investigator can come back with follow-up questions, which usually makes the case easier to resolve.',
  },
]

// The number of days back beyond which the server flags a report as
// unusually old. It does not reject one - see createCaseOnBehalf.js - so this
// is here to warn the staff member before they file, not to gate them.
export const BACKDATE_WARNING_DAYS = 30

// Files a case on behalf of a reporter and returns its one-time credentials.
//
// Everything that decides access is established server-side from the caller's
// Firebase Auth token: the callable takes the company from the signed-in
// account's own claim (never a companyId in this payload) and rejects any
// role other than Case Handler or HR Coordinator. This wrapper deliberately
// sends no identifying information about the caller at all - there is nothing
// here for a tampered client to lie about.
//
// `reporterIdentity` is only sent for the confidential tier, and it is sent
// as plaintext over the callable's TLS channel to be encrypted server-side by
// functions/src/utils/identityVault.js - not encrypted here. src/utils/
// encryption.js exists for draft data that stays in this browser; a key
// shipped in a JS bundle is not what should stand between a reporter's name
// and the world.
//
// The passcode in the response exists nowhere else and cannot be recovered -
// callers must hand it to CaseCredentialsHandoff immediately.
export async function createCaseOnBehalf({
  category,
  responses,
  tier,
  intakeMethod,
  reportedAt,
  reporterInformedOfTier,
  reporterIdentity,
}) {
  const payload = {
    category,
    responses,
    tier,
    intakeMethod,
    // Epoch milliseconds; the server rejects a future value and warns on a
    // very old one.
    reportedAt,
    reporterInformedOfTier,
  }

  if (tier === 'confidential') {
    payload.reporterIdentity = reporterIdentity
  }

  const result = await createCaseOnBehalfCallable(payload)
  return result.data
}
