import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../services/firebase'
import { getUserClaims, checkSuperAdmin } from '../services/authService'

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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const [claims, superAdmin] = await Promise.all([
          getUserClaims(firebaseUser),
          checkSuperAdmin(firebaseUser.uid),
        ])
        setRole(claims.role)
        setCompanyId(claims.companyId)
        setIsSuperAdmin(superAdmin)
      } else {
        setRole(null)
        setCompanyId(null)
        setIsSuperAdmin(false)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const refreshClaims = useCallback(async () => {
    if (!auth.currentUser) return
    const [claims, superAdmin] = await Promise.all([
      getUserClaims(auth.currentUser, true),
      checkSuperAdmin(auth.currentUser.uid),
    ])
    setRole(claims.role)
    setCompanyId(claims.companyId)
    setIsSuperAdmin(superAdmin)
  }, [])

  return (
    <AuthContext.Provider value={{ user, role, companyId, isSuperAdmin, loading, refreshClaims }}>
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
