// One-off local script - NOT deployed as a Cloud Function. Run this once,
// right after companyService.js's companySlugs registry ships, so every
// company that already existed gets a companySlugs/{slug} reservation doc.
//
// Why this matters: reserveUniqueSlug (src/services/companyService.js) makes
// slug allocation atomic by claiming a companySlugs/{slug} doc inside the
// same transaction as the companies/{companyId} write - but it only knows
// about slugs claimed that way. A company created before this registry
// existed has a slug sitting on its companies/{companyId} doc with no
// matching companySlugs entry, so without this backfill a brand new company
// could still claim that same slug (reserveUniqueSlug falls back to a plain
// query against the companies collection to catch this too, but that query
// isn't part of the transaction's atomic read set - this backfill is what
// makes the registry itself the complete, race-safe source of truth going
// forward, and the fallback query a pure safety net rather than the thing
// actually doing the work).
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json \
//     node scripts/backfillCompanySlugs.js
//
// Safe to re-run: a company whose slug is already registered is skipped, and
// a slug collision between two existing companies (which should be
// impossible going forward, but could already exist from before this fix)
// is reported rather than silently overwritten - resolve those by hand.

const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const COMPANIES_COLLECTION = 'companies'
const COMPANY_SLUGS_COLLECTION = 'companySlugs'

async function main() {
  const firestore = admin.firestore()
  const companiesSnapshot = await firestore.collection(COMPANIES_COLLECTION).get()

  let claimed = 0
  let alreadyRegistered = 0
  let skippedNoSlug = 0
  const conflicts = []

  for (const companyDoc of companiesSnapshot.docs) {
    const slug = companyDoc.data().slug
    if (!slug) {
      skippedNoSlug += 1
      continue
    }

    const slugRef = firestore.collection(COMPANY_SLUGS_COLLECTION).doc(slug)
    // eslint-disable-next-line no-await-in-loop -- run sequentially so the
    // conflict report below is deterministic and easy to read; this is a
    // one-off script, not a hot path.
    const result = await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(slugRef)
      if (existing.exists()) {
        return existing.data().companyId === companyDoc.id ? 'already' : 'conflict'
      }
      transaction.set(slugRef, {
        companyId: companyDoc.id,
        reservedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      return 'claimed'
    })

    if (result === 'claimed') claimed += 1
    else if (result === 'already') alreadyRegistered += 1
    else conflicts.push({ slug, companyId: companyDoc.id })
  }

  console.log(`Claimed ${claimed} slug(s), ${alreadyRegistered} already registered, ${skippedNoSlug} company doc(s) with no slug.`)
  if (conflicts.length > 0) {
    console.warn(`${conflicts.length} slug(s) already exist in companies but are registered to a DIFFERENT company - a pre-existing duplicate. Resolve these by hand:`)
    for (const conflict of conflicts) {
      console.warn(`  slug "${conflict.slug}" - companies/${conflict.companyId} could not claim it`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
