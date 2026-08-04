import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../services/firebase'
import { getUserClaims } from '../services/authService'

const AuthContext = createContext(null)

// Tracks the signed-in Firebase user plus their role/companyId custom
// claims. Claims are the only thing firestore.rules and the Cloud Functions
// trust for role checks, so this is a read model for the UI (redirects,
// ProtectedRoute) - never itself a source of authorization.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [companyId, setCompanyId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const claims = await getUserClaims(firebaseUser)
        setRole(claims.role)
        setCompanyId(claims.companyId)
      } else {
        setRole(null)
        setCompanyId(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const refreshClaims = useCallback(async () => {
    if (!auth.currentUser) return
    const claims = await getUserClaims(auth.currentUser, true)
    setRole(claims.role)
    setCompanyId(claims.companyId)
  }, [])

  return (
    <AuthContext.Provider value={{ user, role, companyId, loading, refreshClaims }}>
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
