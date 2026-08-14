const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')

if (!admin.apps.length) {
  admin.initializeApp()
}

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')

// Haiku, deliberately: this is a cheap, high-volume classification - one call
// per chunk, and a policy document produces many chunks - not the reasoning
// scoreCase.js needs. scoreCase.js's model is not touched by this module.
const MODEL = 'claude-haiku-4-5-20251001'

const POLICIES_COLLECTION = 'companyPolicies'

// The same four categories the case system uses (src/data/categories.js /
// scoringPrompt.js). Retrieval is a category-tag lookup against these, which is
// why there are no embeddings here: a chunk is tagged with zero or more of
// these, and getPolicyContext.js pulls chunks by tag.
const CATEGORIES = ['harassment', 'toxicManagement', 'retaliation', 'burnout']

const TAG_SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'array',
      items: { type: 'string', enum: CATEGORIES },
      description:
        'Which case categories this policy passage is relevant to. Zero or more. Only include a category if the passage genuinely governs how that kind of case is handled.',
    },
    summary: {
      type: 'string',
      description: 'A single plain sentence describing what this passage says.',
    },
  },
  required: ['categories', 'summary'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You classify a single passage from a company's own written workplace policy.

You are given one passage. Decide which of these case categories it is relevant to, meaning it would inform how an investigator handles a case of that kind - what procedure applies, what detail matters, what the policy requires:
- harassment: unwanted conduct targeting a person (verbal, written, physical, visual).
- toxicManagement: a sustained pattern of manager behaviour harming an employee's wellbeing or ability to work.
- retaliation: adverse treatment after someone raised a concern or supported someone who did.
- burnout: sustained work-related exhaustion affecting health.

Return zero or more categories - a general "reporting procedure" clause may apply to all of them, a definitions clause about physical contact may apply only to harassment, and a passage about office logistics applies to none. Do not force a category onto an irrelevant passage. Also return a single plain-sentence summary of what the passage says.`

async function tagChunk({ apiKey, text }) {
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: TAG_SCHEMA },
    },
    messages: [{ role: 'user', content: `Passage:\n${text}` }],
  })

  if (response.stop_reason === 'refusal') {
    return { categories: [], summary: '' }
  }
  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return { categories: [], summary: '' }

  const parsed = JSON.parse(textBlock.text)
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.filter((c) => CATEGORIES.includes(c))
    : []
  return {
    categories: Array.from(new Set(categories)),
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 300) : '',
  }
}

// Fires once per newly written chunk. Tags it with the case categories it is
// relevant to and a one-line summary, then folds those categories into the
// parent document's categoriesCovered[] so the admin's coverage summary
// ("harassment: covered, burnout: nothing") stays current as chunks land. The
// parent fold is a transaction so concurrent per-chunk triggers do not clobber
// each other's additions.
exports.tagPolicyChunks = onDocumentCreated(
  { document: 'companyPolicies/{policyId}/chunks/{chunkId}', secrets: [anthropicApiKey] },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) return
    const chunk = snapshot.data()
    const text = typeof chunk.text === 'string' ? chunk.text : ''
    if (!text.trim()) return

    let result
    try {
      result = await tagChunk({ apiKey: anthropicApiKey.value(), text })
    } catch (err) {
      logger.error('tagPolicyChunks: tagging failed', {
        policyId: event.params.policyId,
        chunkId: event.params.chunkId,
        error: err.message,
      })
      // Leave the chunk with its empty defaults rather than blocking - an
      // untagged chunk simply never surfaces as policy context, which degrades
      // gracefully instead of failing the whole document.
      return
    }

    await snapshot.ref.update({
      categories: result.categories,
      summary: result.summary,
    })

    if (result.categories.length === 0) return

    const firestore = admin.firestore()
    const policyRef = firestore.collection(POLICIES_COLLECTION).doc(event.params.policyId)
    await firestore.runTransaction(async (tx) => {
      const policySnapshot = await tx.get(policyRef)
      if (!policySnapshot.exists) return
      const existing = Array.isArray(policySnapshot.data().categoriesCovered)
        ? policySnapshot.data().categoriesCovered
        : []
      const merged = Array.from(new Set([...existing, ...result.categories]))
      if (merged.length !== existing.length) {
        tx.update(policyRef, { categoriesCovered: merged })
      }
    })
  }
)

exports.CATEGORIES = CATEGORIES
exports.tagChunk = tagChunk
