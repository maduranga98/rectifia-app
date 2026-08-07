import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, firestore } from '../services/firebase'
import { getUserClaims, checkSuperAdmin } from '../services/authService'
import { resolveEffectivePermissions, hasPermission as hasPermissionFor } from '../utils/permissions'

// A customRoleId claim names a companies/{companyId}/customRoles doc but
// carries no permissions of its own - resolved fresh from Firestore here
// (readable by any staff of the company, see firestore.rules' customRoles
// match block) rather than cached on the token, so a Company Admin editing a
// custom role's permissions on RoleBuilder.jsx takes effect for every signed-
// in holder without them needing to sign out and back in.
async function loadCustomRolePermissions(companyId, customRoleId) {
  if (!companyId || !customRoleId) return { permissions: [], name: null }
  try {
    const snapshot = await getDoc(doc(firestore, 'companies', companyId, 'customRoles', customRoleId))
    if (!snapshot.exists()) return { permissions: [], name: null }
    const data = snapshot.data()
    return {
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      name: typeof data.name === 'string' ? data.name : null,
    }
  } catch {
    // A failed lookup (deleted role, transient error) resolves to no
    // permissions - fail closed, the same posture every other claims read in
    // this file already takes.
    return { permissions: [], name: null }
  }
}

const AuthContext = createContext(null)

// Tracks the signed-in Firebase user, their role/companyId custom claims,
// and whether they're on the superAdmins Firestore allowlist. Claims are
// what firestore.rules and the Cloud Functions trust for staff role checks;
// isSuperAdmin is a separate, allowlist-doc-backed check (see
// authService.checkSuperAdmin). Either way this is a read model for the UI
// (redirects, ProtectedRoute) - never itself a source of authorization.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [companyId, setCompanyId] = useState(null)
  // Manager pulse-visibility scope, from the `departments` custom claim. Empty
  // for every other role and for a manager who has none assigned yet.
  const [departments, setDepartments] = useState([])
  // Composable custom-role state: customRoleId is the claim, permissions is
  // resolved fresh from Firestore (see loadCustomRolePermissions above).
  // Both stay null/empty for a fixed-role (`role`) account.
  const [customRoleId, setCustomRoleId] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [customRoleName, setCustomRoleName] = useState(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Go back to loading on every auth change, not just the first one.
      // Claims and the superAdmins lookup are async, so without this there
      // is a window right after sign-in where user is set but isSuperAdmin
      // is still false - long enough for ProtectedRoute to bounce a real
      // super admin straight back to the login page.
      setLoading(true)
      setUser(firebaseUser)
      try {
        if (firebaseUser) {
          const [claims, superAdmin] = await Promise.all([
            getUserClaims(firebaseUser),
            checkSuperAdmin(firebaseUser.uid),
          ])
          const resolved = claims.customRoleId
            ? await loadCustomRolePermissions(claims.companyId, claims.customRoleId)
            : { permissions: [], name: null }
          setRole(claims.role)
          setCompanyId(claims.companyId)
          setDepartments(claims.departments)
          setCustomRoleId(claims.customRoleId)
          setPermissions(resolved.permissions)
          setCustomRoleName(resolved.name)
          setIsSuperAdmin(superAdmin)
        } else {
          setRole(null)
          setCompanyId(null)
          setDepartments([])
          setCustomRoleId(null)
          setPermissions([])
          setCustomRoleName(null)
          setIsSuperAdmin(false)
        }
      } catch {
        // A failed claims/allowlist lookup means "not authorized", never a
        // permanent spinner - the guards below re-route to the login page.
        setRole(null)
        setCompanyId(null)
        setDepartments([])
        setCustomRoleId(null)
        setPermissions([])
        setCustomRoleName(null)
        setIsSuperAdmin(false)
      } finally {
        setLoading(false)
      }
    })
    return unsubscribe
  }, [])

  const refreshClaims = useCallback(async () => {
    if (!auth.currentUser) return
    const [claims, superAdmin] = await Promise.all([
      getUserClaims(auth.currentUser, true),
      checkSuperAdmin(auth.currentUser.uid),
    ])
    const resolved = claims.customRoleId
      ? await loadCustomRolePermissions(claims.companyId, claims.customRoleId)
      : { permissions: [], name: null }
    setRole(claims.role)
    setCompanyId(claims.companyId)
    setDepartments(claims.departments)
    setCustomRoleId(claims.customRoleId)
    setPermissions(resolved.permissions)
    setCustomRoleName(resolved.name)
    setIsSuperAdmin(superAdmin)
  }, [])

  // Resolves through the same algorithm permissionResolver.js uses server-
  // side (see src/utils/permissions.js) rather than a raw role-string
  // comparison - ProtectedRoute's requiredPermission prop reads this instead
  // of inspecting `role`/`customRoleId` itself.
  const hasPermission = useCallback(
    (key) => hasPermissionFor(resolveEffectivePermissions({ role, customRoleId, permissions }), key),
    [role, customRoleId, permissions]
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        companyId,
        departments,
        customRoleId,
        permissions,
        customRoleName,
        hasPermission,
        isSuperAdmin,
        loading,
        refreshClaims,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
