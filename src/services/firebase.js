import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { env } from '../config/env'

const app = initializeApp(env.firebase)

// App Check, initialized before anything else touches a Firebase service so
// every subsequent call carries an attestation token.
//
// The reporter-facing callables (submitCase, validateCaseAccess,
// getCaseThread, postReporterMessage, ...) have no Firebase Auth to gate them
// - a whistleblower has no account by design - so App Check is what
// establishes that a call came from this web app at all, rather than from a
// script pointed at the callable endpoint. The functions side enforces it
// (PUBLIC_CALLABLE_OPTIONS in functions/src/utils/rateLimit.js); this is the
// half that produces the token.
//
// Local development: set VITE_APPCHECK_DEBUG_TOKEN to a token registered under
// App Check -> Apps -> Manage debug tokens in the Firebase console. That is the
// only bypass, and it is one the console can revoke. There is deliberately no
// "skip App Check in dev" flag - enforcement stays on in every environment, so
// a misconfiguration surfaces locally instead of at launch.
if (import.meta.env.DEV && env.appCheckDebugToken) {
  // Read by the App Check SDK at initialization time, so it must be set first.
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = env.appCheckDebugToken
}

if (env.recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(env.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  })
} else if (import.meta.env.PROD) {
  // A production build with no site key would send every call without a token,
  // and every enforced callable would reject it. Fail loudly at startup rather
  // than letting the app fail one request at a time in front of a reporter.
  throw new Error(
    'VITE_RECAPTCHA_SITE_KEY is not set. App Check is required: the reporter-facing callables enforce it.'
  )
}

export const auth = getAuth(app)
export const firestore = getFirestore(app)
export const storage = getStorage(app)
export const functions = getFunctions(app)

if (env.useEmulators) {
  connectAuthEmulator(auth, 'http://localhost:9099')
  connectFirestoreEmulator(firestore, 'localhost', 8080)
  connectStorageEmulator(storage, 'localhost', 9199)
  connectFunctionsEmulator(functions, 'localhost', 5001)
}

export default app
