import { initializeApp } from 'firebase/app'
import {
  initializeAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
} from 'firebase/auth'
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

// getAuth() picks indexedDBLocalPersistence on its own in a browser and gives
// no fallback if that store misbehaves. It does misbehave: an invite link
// opened from an email client's in-app browser (or a tab the OS backgrounds
// while the mail app hands the URL over) lands on a page whose IndexedDB
// connection is already closing, and Firebase's persistence layer throws
// "Database is closing/hidden" out of an internal, unawaited promise
// (reloadAndSetCurrentUserOrClear -> _set). That rejection is uncatchable from
// app code and leaves auth half-initialized: signInWithEmailAndPassword can
// resolve while the Functions SDK still finds no current user to mint an ID
// token from, so the very next callable goes out unauthenticated and comes
// back 401. That is exactly the failure a Company Admin hits on
// /invite/:token -> acceptInvite.
//
// initializeAuth takes an ordered list instead: the first entry that is
// actually usable wins, and a failure falls through to the next rather than
// rejecting. localStorage leads deliberately - a session token is a few KB, so
// IndexedDB's size headroom buys this app nothing, and localStorage has no
// closing/hidden state to trip over. inMemoryPersistence anchors the list so a
// browser with all storage blocked still gets a working (tab-lifetime) session
// instead of a broken auth instance.
//
// Must run before anything calls getAuth(app); this module is the only place
// that constructs the Auth instance, and every other module imports `auth`
// from here.
export const auth = initializeAuth(app, {
  persistence: [
    browserLocalPersistence,
    indexedDBLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
  ],
  popupRedirectResolver: browserPopupRedirectResolver,
})
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
