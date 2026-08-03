// Staff roles used across custom claims (functions/src/staff/inviteStaff.js),
// firestore.rules, and every staff-facing dashboard. Keep this list in
// lockstep with the ROLES set in firestore.rules' helper functions - they
// can't literally share this file (rules aren't JS), so a role added here
// must be added there too.
export const ROLES = {
  COMPANY_ADMIN: 'companyAdmin',
  HR_COORDINATOR: 'hrCoordinator',
  CASE_HANDLER: 'caseHandler',
  MANAGER: 'manager',
  PULSE_CHECK_REVIEWER: 'pulseCheckReviewer',
}

export const ROLE_LABELS = {
  [ROLES.COMPANY_ADMIN]: 'Company Admin',
  [ROLES.HR_COORDINATOR]: 'HR Coordinator',
  [ROLES.CASE_HANDLER]: 'Case Handler',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.PULSE_CHECK_REVIEWER]: 'Pulse Check Reviewer',
}

export const ASSIGNABLE_ROLES = Object.values(ROLES)
