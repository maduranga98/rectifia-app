// Centralized access to Vite env vars. Import this instead of reading
// import.meta.env directly elsewhere in the app.
export const env = {
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  },
  useEmulators: import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true",
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
  // App Check. The reCAPTCHA v3 site key is public by design - it identifies
  // the site to reCAPTCHA and is meaningless without the secret half, which
  // lives in the Firebase project. Required in production builds; see
  // src/services/firebase.js.
  recaptchaSiteKey: import.meta.env.VITE_RECAPTCHA_SITE_KEY,
  // Local development only. A token registered under App Check -> Manage debug
  // tokens; ignored entirely in a production build.
  appCheckDebugToken: import.meta.env.VITE_APPCHECK_DEBUG_TOKEN,
};
