import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import { env } from '../config/env'

const app = initializeApp(env.firebase)

// TESTING: App Check is removed for now. This file used to initialize it here
// - before anything else touches a Firebase service - so that every subsequent
// call carried a reCAPTCHA v3 attestation token.
//
// What that bought, and what is therefore missing while it is off: the
// reporter-facing callables (submitCase, validateCaseAccess, getCaseThread,
// postReporterMessage, ...) have no Firebase Auth to gate them, because a
// whistleblower has no account by design. App Check was what established that
// a call came from this web app at all rather than from a script pointed at
// the callable endpoint. The functions side is off to match
// (PUBLIC_CALLABLE_OPTIONS in functions/src/utils/rateLimit.js).
//
// To restore: re-add initializeAppCheck with a ReCaptchaV3Provider over
// VITE_RECAPTCHA_SITE_KEY, set self.FIREBASE_APPCHECK_DEBUG_TOKEN from
// VITE_APPCHECK_DEBUG_TOKEN in dev, and flip enforceAppCheck back to true.

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
