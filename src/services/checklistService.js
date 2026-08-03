import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export const CHECKLIST_ITEM_TYPES = {
  INTERVIEW_QUESTION: 'interview_question',
  DOCUMENT_REQUEST: 'document_request',
  CONTRADICTION_FLAG: 'contradiction_flag',
}

export const CHECKLIST_ITEM_STATUSES = {
  SUGGESTED: 'suggested',
  CHECKED: 'checked',
  EDITED: 'edited',
  IGNORED: 'ignored',
}

const generateChecklistCallable = httpsCallable(functions, 'generateChecklist')
const updateChecklistItemCallable = httpsCallable(functions, 'updateChecklistItem')

// Regenerates the checklist from the case's current category, questionnaire
// responses, and full thread - see functions/src/intake/generateChecklist.js.
// This replaces any previous checklist rather than merging into it.
export async function generateChecklist(caseId, investigatorId) {
  const result = await generateChecklistCallable({ caseId, investigatorId })
  return result.data.checklist
}

// status is one of CHECKLIST_ITEM_STATUSES; text is only required (and only
// used) when status is 'edited'.
export async function setChecklistItemStatus(caseId, itemId, status, text) {
  const result = await updateChecklistItemCallable({ caseId, itemId, status, text })
  return result.data.checklist
}
