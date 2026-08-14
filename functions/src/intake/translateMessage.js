const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Anthropic = require('@anthropic-ai/sdk')
const { requireAuthUid, loadCaseForHandler } = require('../utils/staffAuth')

if (!admin.apps.length) {
  admin.initializeApp()
}

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY')
const MODEL = 'claude-haiku-4-5-20251001'

const MESSAGES_SUBCOLLECTION = 'messages'

// Must match src/services/i18n.js's SUPPORTED_LANGUAGES exactly - this is the
// server-side allowlist for a callable that spends a Claude call per
// invocation, so it has to reject any language the UI cannot even offer.
const SUPPORTED_LANGUAGES = ['en', 'si']
const LANGUAGE_NAMES = { en: 'English', si: 'Sinhala' }

const TRANSLATION_SCHEMA = {
  type: 'object',
  properties: {
    translatedText: {
      type: 'string',
      description: 'The message translated into the target language, preserving meaning and tone exactly.',
    },
    sourceLanguageGuess: {
      type: 'string',
      description: 'Best guess at the original language of the message, as a short label (e.g. "English", "Sinhala").',
    },
  },
  required: ['translatedText', 'sourceLanguageGuess'],
  additionalProperties: false,
}

// This prompt has exactly one job: translate. Not summarize, not soften, not
// comment. A crisis disclosure or a graphic detail must read to the
// translation's audience exactly as it reads to a native speaker of the
// original - and none of this ever touches scoreCase.js's crisis detection,
// which runs server-side against the original text regardless of language
// and is completely unaffected by anything in this module.
const TRANSLATION_SYSTEM_PROMPT = `You translate a single message from a workplace-incident case thread into a target language.

Rules, no exceptions:
- Translate only. Never summarize, shorten, or omit any part of the message.
- Preserve meaning and tone as closely as the target language allows - including urgency, distress, or crisis-related content. A native reader of the translation must come away with exactly the same substance a native reader of the original would get.
- Never add commentary, warnings, explanations, or anything not present in the original message.
- Never soften, sanitize, or euphemize distressing or crisis-related content.
- If the message is already in the target language, return it unchanged as translatedText.`

async function translateWithClaude({ apiKey, text, targetLang }) {
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: TRANSLATION_SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: TRANSLATION_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Target language: ${LANGUAGE_NAMES[targetLang]} (${targetLang})\n\nMessage:\n${text}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new HttpsError('internal', 'Translation was refused')
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) {
    throw new HttpsError('internal', 'Translation failed')
  }

  const parsed = JSON.parse(textBlock.text)
  return {
    translatedText: typeof parsed.translatedText === 'string' ? parsed.translatedText : '',
    sourceLanguageGuess: typeof parsed.sourceLanguageGuess === 'string' ? parsed.sourceLanguageGuess : '',
  }
}

function serializeTranslation(entry) {
  return {
    text: entry?.text ?? '',
    sourceLanguageGuess: entry?.sourceLanguageGuess ?? null,
    model: entry?.model ?? null,
    translatedAt: typeof entry?.translatedAt?.toMillis === 'function' ? entry.translatedAt.toMillis() : null,
    translatedBy: entry?.translatedBy ?? null,
  }
}

// On-demand, per-message translation for the Case Handler side of the case
// thread only - one click, one message, one target language, spending exactly
// one Claude call (unless a translation for that language already exists).
// There is deliberately no reporter-facing counterpart, no auto-translation
// on arrival, and no general free-text translation path: this only ever
// translates the text already stored on one existing message doc by ID.
//
// Writes are purely additive, under messages/{messageId}.translations.
// {targetLang} - message.text and every other field on the doc are untouched,
// so nothing downstream of the original text (scoring, crisis detection, the
// audit trail) is affected by a translation ever having happened.
exports.translateMessage = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  const uid = requireAuthUid(request)
  const { caseId, messageId, targetLang } = request.data || {}

  if (!messageId) {
    throw new HttpsError('invalid-argument', 'messageId is required')
  }
  if (!SUPPORTED_LANGUAGES.includes(targetLang)) {
    throw new HttpsError('invalid-argument', `targetLang must be one of ${SUPPORTED_LANGUAGES.join(', ')}`)
  }

  const firestore = admin.firestore()
  // Same investigator-only, assigned-handler gate every other case-content
  // action uses - this is what keeps translation unreachable from the
  // unauthenticated reporter/passcode path. Logged under 'message_translate'
  // whether granted or denied: having Claude read the reporter's content is
  // itself the privileged act, same as any other access to it.
  const { caseRef } = await loadCaseForHandler(firestore, caseId, uid, 'message_translate')

  const messageRef = caseRef.collection(MESSAGES_SUBCOLLECTION).doc(messageId)
  const messageSnapshot = await messageRef.get()
  if (!messageSnapshot.exists) {
    throw new HttpsError('not-found', 'No such message')
  }

  const messageData = messageSnapshot.data()

  // Idempotent per language: the client already checks
  // message.translations[targetLang] before calling this at all (its fast
  // path), so reaching this point with an existing entry means a second
  // investigator, or a retry, asked for the same thing. Return it rather than
  // spending a second Claude call, and never overwrite an entry already
  // settled for this language.
  const existing = messageData.translations?.[targetLang]
  if (existing) {
    return { translation: serializeTranslation(existing) }
  }

  const text = typeof messageData.text === 'string' ? messageData.text : ''
  if (!text.trim()) {
    throw new HttpsError('failed-precondition', 'This message has no text to translate')
  }

  let result
  try {
    result = await translateWithClaude({ apiKey: anthropicApiKey.value(), text, targetLang })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    logger.error('translateMessage: translation failed', { caseId, messageId, error: err.message })
    throw new HttpsError('internal', 'Translation failed')
  }

  const translatedAt = admin.firestore.Timestamp.now()
  const translation = {
    text: result.translatedText,
    sourceLanguageGuess: result.sourceLanguageGuess,
    model: MODEL,
    translatedAt,
    translatedBy: uid,
  }

  await messageRef.update({ [`translations.${targetLang}`]: translation })

  return { translation: serializeTranslation(translation) }
})
