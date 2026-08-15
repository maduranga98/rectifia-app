import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  MAX_QUESTION_TEXT_LENGTH,
  MAX_SUPPLEMENTARY_QUESTIONS,
  getPublishedQuestionSet,
  publishQuestionSet,
  saveSupplementaryQuestions,
  sendTestPulseInvite,
  sortQuestions,
} from '../../services/pulseQuestionService'
import QuestionSetPreview from '../../components/pulse-check/QuestionSetPreview'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

// Supplementary ids are generated once, when the question is added, and never
// derived from its text. An id derived from the wording would change the moment
// someone fixed a typo, and every stored answer keyed to the old id would stop
// resolving to anything - which is precisely what the version history exists to
// prevent. Matches the server's id pattern in functions/src/pulse/questionSet.js.
function newQuestionId() {
  return `added_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// publishedAt arrives through a callable, so it is a JSON-serialized Firestore
// Timestamp ({_seconds, _nanoseconds}) rather than a Timestamp instance - the
// same value read straight from Firestore would have .toMillis(). Both shapes
// are handled so this works from either source.
function toMillis(value) {
  if (!value) return null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value._seconds === 'number') return value._seconds * 1000
  if (typeof value.seconds === 'number') return value.seconds * 1000
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function formatDateTime(value) {
  const ms = toMillis(value)
  if (!ms) return null
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Compares a draft list against what is published, so the page can honestly
// distinguish "you have unsaved edits" from "you have saved edits that nobody
// has received yet". Those are different states and conflating them is how
// someone ends up believing a question went out that never did.
function sameQuestions(a, b) {
  if (a.length !== b.length) return false
  return a.every((q, i) => q.id === b[i].id && q.text === b[i].text && q.type === b[i].type)
}

// The core set, rendered read-only. This is not a disabled form - there is no
// form. The explanation matters as much as the list: an admin who cannot edit
// something deserves to know why, or they will assume it is an oversight and
// ask for it to be unlocked.
function CoreQuestionsCard({ questions }) {
  const { t } = useTranslation()
  const typeLabels = {
    scale: t('pulseQuestionsPage.typeLabels.scale'),
    freeText: t('pulseQuestionsPage.typeLabels.freeText'),
  }
  return (
    <Card
      title={t('pulseQuestionsPage.coreQuestions.title')}
      description={t('pulseQuestionsPage.coreQuestions.description')}
    >
      <div className="flex flex-col gap-4">
        <ol className="flex flex-col gap-2">
          {questions.map((q, index) => (
            <li
              key={q.id}
              className="flex items-start gap-3 rounded-lg border border-line bg-navy-50 px-4 py-3"
            >
              <span className="mt-0.5 text-sm font-semibold tabular-nums text-muted">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-charcoal">{q.text}</p>
                <p className="mt-0.5 text-xs text-muted">{typeLabels[q.type] ?? q.type}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-line px-4 py-3">
          <p className="text-sm font-medium text-charcoal">
            {t('pulseQuestionsPage.coreQuestions.whyFixedTitle')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {t('pulseQuestionsPage.coreQuestions.whyFixedBody')}
          </p>
        </div>
      </div>
    </Card>
  )
}

// Company Admin's questionnaire editor. Two tiers, two very different
// affordances: the core set above is read-only and explained; supplementary
// questions below are freely editable, capped, and only reach anyone on an
// explicit Publish.
function PulseQuestionsPage({ companyId }) {
  const { t } = useTranslation()
  const typeLabels = {
    scale: t('pulseQuestionsPage.typeLabels.scale'),
    freeText: t('pulseQuestionsPage.typeLabels.freeText'),
  }
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getPublishedQuestionSet(companyId)
      setData(result)
      setDraft(result.draft ?? [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  function updateQuestion(id, patch) {
    setDraft((current) => current.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  function addQuestion() {
    setDraft((current) =>
      current.length >= MAX_SUPPLEMENTARY_QUESTIONS
        ? current
        : [...current, { id: newQuestionId(), text: '', type: 'scale' }]
    )
  }

  function removeQuestion(id) {
    setDraft((current) => current.filter((q) => q.id !== id))
  }

  async function handleSaveDraft() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await saveSupplementaryQuestions(
        companyId,
        draft.map((q) => ({ id: q.id, text: q.text.trim(), type: q.type }))
      )
      await refresh()
      setNotice(t('pulseQuestionsPage.draftSaved'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    setPublishing(true)
    setError(null)
    setNotice(null)
    try {
      const { version } = await publishQuestionSet(companyId)
      setConfirmPublish(false)
      await refresh()
      setNotice(t('pulseQuestionsPage.publishedNotice', { version }))
    } catch (err) {
      setConfirmPublish(false)
      setError(err.message)
    } finally {
      setPublishing(false)
    }
  }

  async function handleSendTest() {
    setSendingTest(true)
    setError(null)
    setNotice(null)
    try {
      const { recipientEmail } = await sendTestPulseInvite(companyId)
      setNotice(t('pulseQuestionsPage.testSentNotice', { email: recipientEmail }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSendingTest(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <SkeletonList rows={4} />
      </div>
    )
  }

  const published = data?.published
  const publishedQuestions = sortQuestions(published?.questions)
  const coreQuestions = publishedQuestions.filter((q) => q.tier !== 'supplementary')
  const publishedSupplementary = publishedQuestions
    .filter((q) => q.tier === 'supplementary')
    .map((q) => ({ id: q.id, text: q.text, type: q.type }))

  const savedDraft = (data?.draft ?? []).map((q) => ({ id: q.id, text: q.text, type: q.type }))
  const normalizedDraft = draft.map((q) => ({ id: q.id, text: q.text.trim(), type: q.type }))

  const unsavedEdits = !sameQuestions(normalizedDraft, savedDraft)
  const unpublishedChanges = !sameQuestions(savedDraft, publishedSupplementary)
  const neverPublished = !data?.activeQuestionSetVersion

  const tooLong = normalizedDraft.some((q) => q.text.length > MAX_QUESTION_TEXT_LENGTH)
  const anyEmpty = normalizedDraft.some((q) => q.text.length === 0)
  const draftValid = !tooLong && !anyEmpty
  const publishedAtLabel = formatDateTime(published?.publishedAt)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        {t('pulseQuestionsPage.intro', { max: MAX_SUPPLEMENTARY_QUESTIONS })}
      </p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {neverPublished && (
        <Alert variant="warning" title={t('pulseQuestionsPage.neverPublished.title')}>
          {t('pulseQuestionsPage.neverPublished.body')}
        </Alert>
      )}

      <CoreQuestionsCard questions={coreQuestions} />

      <Card
        title={t('pulseQuestionsPage.addedQuestions.title')}
        description={t('pulseQuestionsPage.addedQuestions.description')}
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleSaveDraft}
              loading={saving}
              loadingLabel={t('pulseQuestionsPage.saving')}
              disabled={!unsavedEdits || !draftValid}
            >
              {t('pulseQuestionsPage.saveDraft')}
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirmPublish(true)}
              disabled={saving || publishing || unsavedEdits || (!unpublishedChanges && !neverPublished)}
            >
              {t('pulseQuestionsPage.publish')}
            </Button>
            {unsavedEdits ? (
              <span className="text-xs text-muted">{t('pulseQuestionsPage.unsavedChanges')}</span>
            ) : unpublishedChanges ? (
              <span className="text-xs text-medium">{t('pulseQuestionsPage.savedNotPublished')}</span>
            ) : neverPublished ? (
              <span className="text-xs text-muted">{t('pulseQuestionsPage.publishToStart')}</span>
            ) : (
              <span className="text-xs text-muted">{t('pulseQuestionsPage.liveUpToDate')}</span>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Standing, always visible while composing - not a one-time modal
              somebody dismisses before they have written anything. What it warns
              about is not a rule that can be enforced by validation: a question
              can ask an employee to name someone without containing any word a
              filter could catch. */}
          <Alert variant="warning" title={t('pulseQuestionsPage.doNotAskWarning.title')}>
            {t('pulseQuestionsPage.doNotAskWarning.body')}
          </Alert>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {t('pulseQuestionsPage.usedCount', { count: draft.length, max: MAX_SUPPLEMENTARY_QUESTIONS })}
            </span>
            <Button
              variant="secondary"
              icon="plus"
              onClick={addQuestion}
              disabled={draft.length >= MAX_SUPPLEMENTARY_QUESTIONS}
            >
              {t('pulseQuestionsPage.addQuestion')}
            </Button>
          </div>

          {draft.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              {t('pulseQuestionsPage.noAddedQuestions')}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {draft.map((q, index) => {
                const length = q.text.trim().length
                const over = length > MAX_QUESTION_TEXT_LENGTH
                return (
                  <li key={q.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium uppercase tracking-wide text-subtle">
                          {t('pulseQuestionsPage.addedQuestionLabel', { index: index + 1 })}
                        </span>
                        <Button variant="ghost" onClick={() => removeQuestion(q.id)}>
                          {t('pulseQuestionsPage.remove')}
                        </Button>
                      </div>

                      <label className="flex flex-col gap-1.5 text-sm">
                        <span className="font-medium text-charcoal">{t('pulseQuestionsPage.questionLabel')}</span>
                        <textarea
                          rows={2}
                          value={q.text}
                          onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                          placeholder={t('pulseQuestionsPage.questionPlaceholder')}
                          className={`field ${over ? 'border-critical' : ''}`}
                        />
                        <span className={`text-xs ${over ? 'text-critical' : 'text-muted'}`}>
                          {t('pulseQuestionsPage.charactersCount', { length, max: MAX_QUESTION_TEXT_LENGTH })}
                        </span>
                      </label>

                      <div className="sm:max-w-xs">
                        <Select
                          label={t('pulseQuestionsPage.answerType')}
                          value={q.type}
                          onChange={(e) => updateQuestion(q.id, { type: e.target.value })}
                        >
                          <option value="scale">{typeLabels.scale}</option>
                          <option value="freeText">{typeLabels.freeText}</option>
                        </Select>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {anyEmpty && (
            <p className="text-xs text-critical">{t('pulseQuestionsPage.everyQuestionNeedsText')}</p>
          )}

          {/* Removing a question is forward-only, and saying so here is the
              difference between an admin thinking they have erased something and
              knowing they have not. */}
          {draft.length < publishedSupplementary.length && (
            <Alert variant="info">{t('pulseQuestionsPage.removalNotice')}</Alert>
          )}
        </div>
      </Card>

      <Card
        title={t('pulseQuestionsPage.preview.title')}
        description={t('pulseQuestionsPage.preview.description')}
      >
        <div className="flex flex-col gap-5">
          {published && (
            <QuestionSetPreview
              questionSet={published}
              unpublishedChanges={unpublishedChanges || unsavedEdits}
            />
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="secondary"
              icon="mail"
              onClick={handleSendTest}
              loading={sendingTest}
              loadingLabel={t('pulseQuestionsPage.sending')}
            >
              {t('pulseQuestionsPage.sendTestButton')}
            </Button>
            <span className="text-xs text-muted">{t('pulseQuestionsPage.sendTestHint')}</span>
          </div>

          {publishedAtLabel && (
            <p className="text-xs text-muted">
              <Badge tone="tone-neutral">{t('pulseQuestionsPage.versionBadge', { version: published.version })}</Badge>{' '}
              {t('pulseQuestionsPage.publishedOn', { date: publishedAtLabel })}
            </p>
          )}
        </div>
      </Card>

      {confirmPublish && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-title"
        >
          <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
            <h2 id="publish-title" className="text-lg font-semibold text-charcoal">
              {t('pulseQuestionsPage.publishModal.title')}
            </h2>
            <div className="mt-3 flex flex-col gap-2 text-sm text-muted">
              <p>{t('pulseQuestionsPage.publishModal.intro')}</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                <li>
                  <Trans
                    i18nKey="pulseQuestionsPage.publishModal.bullet1"
                    components={{ strong: <strong className="text-charcoal" /> }}
                  />
                </li>
                <li>{t('pulseQuestionsPage.publishModal.bullet2')}</li>
                <li>{t('pulseQuestionsPage.publishModal.bullet3')}</li>
                <li>{t('pulseQuestionsPage.publishModal.bullet4')}</li>
              </ul>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmPublish(false)} disabled={publishing}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handlePublish}
                loading={publishing}
                loadingLabel={t('pulseQuestionsPage.publishing')}
              >
                {t('pulseQuestionsPage.publish')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PulseQuestionsPage
