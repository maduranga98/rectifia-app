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
  // App Check (see src/services/firebase.js). The site key is public by
  // design; the debug token is only honoured in dev/emulator builds.
  recaptchaSiteKey: import.meta.env.VITE_RECAPTCHA_SITE_KEY,
  appCheckDebugToken: import.meta.env.VITE_APPCHECK_DEBUG_TOKEN,
};
