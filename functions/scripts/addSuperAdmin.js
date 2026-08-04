// One-off local script - NOT deployed as a Cloud Function on purpose. A
// callable that can add entries to the superAdmins allowlist is too
// dangerous to expose as an HTTP endpoint; this only runs with a service
// account key on someone's own machine, matching how a new tenant's first
// Company Admin / Super Admin account is meant to be created directly by
// Lumora (see AcceptInvitePage's constraints - there is no self-signup
// path).
//
// Adds a doc at superAdmins/{uid} with { email, uid, createdAt }.
// firestore.rules only lets that account read its own doc back - writes are
// admin-only, which is exactly what this script does with the Admin SDK.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
//     node scripts/addSuperAdmin.js <uid-or-email>
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
    console.error('Usage: node scripts/addSuperAdmin.js <uid-or-email>')
    process.exit(1)
  }

  const user = identifier.includes('@')
    ? await admin.auth().getUserByEmail(identifier)
    : await admin.auth().getUser(identifier)

  await admin.firestore().collection('superAdmins').doc(user.uid).set({
    email: user.email,
    uid: user.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  console.log(`Added ${user.email} (${user.uid}) to superAdmins.`)
  console.log('They can sign in at /super-admin/login now.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
