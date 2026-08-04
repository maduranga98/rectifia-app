// One-off local script - NOT deployed as a Cloud Function on purpose. A
// callable that can mint 'super_admin' claims is too dangerous to expose as
// an HTTP endpoint; this only runs with a service account key on someone's
// own machine, matching how a new tenant's first Company Admin / Super
// Admin account is meant to be created directly by Lumora (see
// AcceptInvitePage's constraints - there is no self-signup path).
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
//     node scripts/setSuperAdminClaim.js <uid-or-email>
//
// Get a service account key from Firebase Console > Project settings >
// Service accounts > Generate new private key.

const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

async function main() {
  const identifier = process.argv[2]
  if (!identifier) {
    console.error('Usage: node scripts/setSuperAdminClaim.js <uid-or-email>')
    process.exit(1)
  }

  const user = identifier.includes('@')
    ? await admin.auth().getUserByEmail(identifier)
    : await admin.auth().getUser(identifier)

  await admin.auth().setCustomUserClaims(user.uid, { role: 'super_admin' })

  console.log(`Set role=super_admin on ${user.email} (${user.uid})`)
  console.log('They must sign out and back in for the new claim to take effect.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
