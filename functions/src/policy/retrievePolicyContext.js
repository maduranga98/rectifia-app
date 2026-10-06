const admin = require('firebase-admin')
const { resolveFlag } = require('../utils/featureFlags')

if (!admin.apps.length) {
  admin.initializeApp()
}

const POLICIES_COLLECTION = 'companyPolicies'
const CHUNKS_SUBCOLLECTION = 'chunks'

// The character budget for injected policy context. Kept modest so grounding
// informs the prompt without dominating it - the reporter's account and the
// category rubric must remain the substance of what the model reasons over.
const MAX_CONTEXT_CHARS = 6000

// ---------------------------------------------------------------------------
// Relevance rules. These only decide which passages are offered to the model as
// advisory context; they never influence a score, a route or an action.
// KEEP IN SYNC BY HAND with src/services/policyService.js, which applies the
// same rules so the "Provided as context" and "Added since scoring" sections
// of PolicyReferences.jsx agree with what retrieval would actually pick.
// ---------------------------------------------------------------------------

// A policy with no jurisdictions field (every policy uploaded so far) is
// treated as 'Generic' at read time. That is the backfill: nothing is written
// to existing documents and no jurisdiction is guessed for them.
const GENERIC_JURISDICTION = 'Generic'

// Headings (matched case-insensitively as substrings, against any level of a
// chunk's heading path) that decide whether a clause from a NON-primary policy
// may still be offered. Procedure carries across categories; what a company
// concluded or imposed for a different kind of conduct does not. DENY wins over
// ALLOW, so "Investigation Process > Outcomes" is excluded.
const NON_PRIMARY_HEADING_RULES = {
  allow: ['how to report', 'investigation process', 'confidentiality'],
  deny: ['outcome', 'consequence'],
}

function policyJurisdictions(policy) {
  const list = Array.isArray(policy?.jurisdictions)
    ? policy.jurisdictions.filter((j) => typeof j === 'string' && j.trim())
    : []
  return list.length > 0 ? list : [GENERIC_JURISDICTION]
}

// Included when the policy is Generic or shares at least one jurisdiction with
// the company. A company with none recorded therefore only sees Generic policy.
function policyAppliesToJurisdictions(policy, companyJurisdictions) {
  const policyList = policyJurisdictions(policy)
  if (policyList.includes(GENERIC_JURISDICTION)) return true
  const company = Array.isArray(companyJurisdictions) ? companyJurisdictions : []
  return policyList.some((j) => company.includes(j))
}

function isProceduralHeading(headingPath) {
  const headings = (Array.isArray(headingPath) ? headingPath : []).map((h) => String(h).toLowerCase())
  if (headings.some((h) => NON_PRIMARY_HEADING_RULES.deny.some((phrase) => h.includes(phrase)))) {
    return false
  }
  return headings.some((h) => NON_PRIMARY_HEADING_RULES.allow.some((phrase) => h.includes(phrase)))
}

// A policy's primary category is the one its chunks are tagged with most often
// (all tied categories count). Derived at read time so it needs no stored field
// and works for policies ingested before this existed.
function primaryCategories(chunks) {
  const counts = new Map()
  for (const chunk of chunks) {
    for (const category of Array.isArray(chunk.categories) ? chunk.categories : []) {
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  const max = Math.max(0, ...counts.values())
  return new Set([...counts].filter(([, n]) => n === max && max > 0).map(([c]) => c))
}

// The chunks of one policy that are relevant to `category`, in the cross-
// category guard's terms: always when the policy's primary category is
// `category`, otherwise only procedural clauses.
function relevantChunks(chunks, category) {
  const primary = primaryCategories(chunks).has(category)
  return chunks.filter(
    (chunk) =>
      Array.isArray(chunk.categories) &&
      chunk.categories.includes(category) &&
      (primary || isProceduralHeading(chunk.headingPath))
  )
}

function headingLabel(headingPath) {
  return Array.isArray(headingPath) && headingPath.length > 0 ? headingPath.join(' > ') : null
}

// Shared helper, NOT a deployed function. Given a company and a case category,
// returns the company's own written policy passages relevant to that category,
// formatted for injection, plus a citation list recording exactly which chunks
// were used.
//
// GRACEFUL DEGRADATION IS THE CONTRACT: a company that has uploaded nothing (or
// nothing tagged for this category) gets { text: '', citations: [] }, and the
// callers append nothing, so the prompt is byte-identical to today's. Nothing
// about scoring, checklists, or follow-ups may depend on policy being present.
//
// The passages are labelled reference material only. The prompt wrappers
// (scoringPrompt.js etc.) frame them as "the company's own written policy" that
// informs what detail matters and what procedure applies - never what the
// outcome should be. This helper does not itself decide anything; it retrieves.
async function getPolicyContext(companyId, category) {
  const empty = { text: '', citations: [] }
  if (!companyId || !category) return empty

  const firestore = admin.firestore()

  // Before any read: a company that has turned policy grounding off gets
  // exactly the same degrade-to-empty result as a company that has never
  // uploaded a policy. scoreCase, generateChecklist and aiFollowUp all
  // already treat an empty result as "prompt unchanged" - this flag never
  // touches whether THEY run, only whether their prompt gets this
  // injection.
  const companySnapshot = await firestore.collection('companies').doc(companyId).get()
  const companyData = companySnapshot.exists ? companySnapshot.data() : null
  if (!resolveFlag(companyData, 'policyGrounding')) {
    return empty
  }
  const companyJurisdictions = companyData?.jurisdictions ?? []

  let policySnapshot
  try {
    policySnapshot = await firestore
      .collection(POLICIES_COLLECTION)
      .where('companyId', '==', companyId)
      .where('status', '==', 'active')
      .get()
  } catch {
    // A retrieval failure must never break the AI call it feeds - degrade to
    // no context rather than throwing into scoreCase/generateChecklist/etc.
    return empty
  }
  if (policySnapshot.empty) return empty

  // Newest version first, so when two versions of a title are both somehow
  // active the more recent clauses lead. A document's chunks are then kept
  // contiguous (all of one document's matching chunks before the next), which
  // is what makes the injected block read as coherent excerpts rather than a
  // shuffled bag of sentences.
  const policies = policySnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((policy) => policyAppliesToJurisdictions(policy, companyJurisdictions))
    .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))

  const blocks = []
  const citations = []
  let used = 0

  for (const policy of policies) {
    if (used >= MAX_CONTEXT_CHARS) break

    let chunkSnapshot
    try {
      chunkSnapshot = await firestore
        .collection(POLICIES_COLLECTION)
        .doc(policy.id)
        .collection(CHUNKS_SUBCOLLECTION)
        .get()
    } catch {
      continue
    }
    if (chunkSnapshot.empty) continue

    // All of the policy's chunks are read (not just the matching ones) because
    // its primary category is derived from how its chunks are tagged.
    const chunks = relevantChunks(
      chunkSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      category
    ).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))

    for (const chunk of chunks) {
      const text = typeof chunk.text === 'string' ? chunk.text : ''
      if (!text) continue
      const heading = headingLabel(chunk.headingPath)
      const label = `[${policy.title} (v${policy.version})${heading ? ` - ${heading}` : ''}]`
      const block = `${label}\n${text}`

      // Stop before overflowing the cap. A single chunk that alone exceeds the
      // remaining budget is skipped rather than truncated, so a citation always
      // corresponds to a whole clause the model actually saw.
      if (used + block.length > MAX_CONTEXT_CHARS && blocks.length > 0) {
        break
      }
      blocks.push(block)
      used += block.length + 2
      citations.push({
        policyId: policy.id,
        chunkId: chunk.id,
        title: policy.title ?? null,
        version: typeof policy.version === 'number' ? policy.version : null,
        headingPath: Array.isArray(chunk.headingPath) ? chunk.headingPath : [],
        order: typeof chunk.order === 'number' ? chunk.order : null,
      })
    }
  }

  if (blocks.length === 0) return empty
  return { text: blocks.join('\n\n'), citations }
}

module.exports = {
  getPolicyContext,
  MAX_CONTEXT_CHARS,
  GENERIC_JURISDICTION,
  NON_PRIMARY_HEADING_RULES,
  policyAppliesToJurisdictions,
  isProceduralHeading,
  primaryCategories,
  relevantChunks,
}
