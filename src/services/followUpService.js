import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

// The structured answers a reporter can give to a follow-up prompt. These
// strings must match ANSWER in functions/src/followup/followUpConstants.js
// exactly - the callable validates against that same set.
export const FOLLOW_UP_ANSWERS = {
  NO_CHANGE: 'no_change',
  CONCERN: 'concern',
  DECLINE: 'decline',
  STOP: 'stop',
}

// Per-prompt / per-case follow-up statuses, matching PROMPT_STATUS server-side.
// 'no_response' means UNKNOWN - the reporter did not return - and must never be
// presented as evidence that no retaliation occurred.
export const FOLLOW_UP_STATUS = {
  SCHEDULED: 'scheduled',
  SENT: 'sent',
  ANSWERED_NO_CHANGE: 'answered_no_change',
  ANSWERED_CONCERN: 'answered_concern',
  DECLINED: 'declined',
  NO_RESPONSE: 'no_response',
}

const submitFollowUpResponseCallable = httpsCallable(functions, 'submitFollowUpResponse')

// Records a reporter's answer to a follow-up prompt over the anonymous Case ID
// + passcode channel - no identity is ever sent. On a 'concern' answer the
// caller may additionally ask to file a retaliation case (fileRetaliationCase)
// and, only if they consent, link it to the original (linkToOriginal, default
// false). When a case is filed the response carries { filed, newCaseId,
// newPasscode } - the passcode is returned exactly once and is shown to the
// reporter to save; it is never stored anywhere retrievable.
export async function submitFollowUpResponse({
  caseId,
  passcode,
  answer,
  freeText = '',
  fileRetaliationCase = false,
  linkToOriginal = false,
}) {
  const result = await submitFollowUpResponseCallable({
    caseId,
    passcode,
    answer,
    freeText,
    fileRetaliationCase,
    linkToOriginal,
  })
  return result.data
}
