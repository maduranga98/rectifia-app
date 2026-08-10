// The fixed allowlist of composable permission keys a Company Admin may
// combine into a custom role (RoleBuilder.jsx). This is a structural
// exclusion, not a UI filter: caseHandler and hrCoordinator access is never
// expressed as a key here, so there is nothing for a custom role to select
// that would grant it, no matter how RoleBuilder.jsx is edited or bypassed.
//
// Must stay in lockstep with PERMISSION_MODULE_KEYS in
// functions/src/utils/permissionResolver.js and the customRoles validation
// in firestore.rules - the same "can't literally share this file" tradeoff
// src/constants/roles.js documents for ROLES vs. firestore.rules' role
// helpers, since rules files and Cloud Functions can't import a Vite ES
// module across that build boundary.
export const PERMISSION_MODULES = {
  departments: {
    label: 'Departments',
    description: 'Create, rename, and manage the company department list.',
  },
  staffManagement: {
    label: 'Staff management',
    description: 'View the staff roster and suspend or reactivate accounts.',
  },
  routingRules: {
    label: 'Routing rules',
    description: 'Configure which Case Handler a category/department pairing routes to.',
  },
  policyManagement: {
    label: 'Policy management',
    description: 'Upload, archive, and restore the company’s written policy documents.',
  },
  retentionSettings: {
    label: 'Data retention settings',
    description: 'Configure how long identities, cases, and pulse responses are retained.',
  },
  billingView: {
    label: 'Billing (view only)',
    description: 'View the current subscription tier and billing quote.',
  },
  complianceConfig: {
    label: 'Compliance configuration',
    description: 'Configure the jurisdictions the company reports and complies under.',
  },
  pulseAggregateView: {
    label: 'Pulse Check aggregate view',
    description: 'View department-level Pulse Check aggregate results. Never individual responses.',
  },
  designatedHandlers: {
    label: 'Designated handlers (JP)',
    description:
      "Designate or revoke a Case Handler's 従事者 status under Japan's Whistleblower Protection Act, and view the register.",
  },
}

// The ONLY permission keys that may ever appear in a custom role's
// `permissions` array. caseHandler and hrCoordinator capabilities are not,
// and must never become, entries in this list - see the module comment.
export const PERMISSION_MODULE_KEYS = Object.freeze(Object.keys(PERMISSION_MODULES))

export function isValidPermissionKey(key) {
  return PERMISSION_MODULE_KEYS.includes(key)
}

// Filters an arbitrary array down to valid, de-duplicated permission keys.
// Used by RoleBuilder.jsx / roleService.js as the client-side mirror of the
// server-side allowlist check - never the actual security boundary (see
// permissionResolver.js and firestore.rules for that), just so the UI can't
// even construct a request containing an unknown key.
export function sanitizePermissionKeys(keys) {
  if (!Array.isArray(keys)) return []
  const seen = new Set()
  const result = []
  for (const key of keys) {
    if (isValidPermissionKey(key) && !seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  return result
}
