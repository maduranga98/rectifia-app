import { useCallback, useEffect, useState } from 'react'
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

const TYPE_LABELS = {
  scale: '1-5 scale',
  freeText: 'Free text',
}

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
  return (
    <Card
      title="Standard questions"
      description="Every company asks these four, in this order, unchanged. They cannot be edited, reordered, or removed."
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
                <p className="mt-0.5 text-xs text-muted">{TYPE_LABELS[q.type] ?? q.type}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-line px-4 py-3">
          <p className="text-sm font-medium text-charcoal">Why these are fixed</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            The wellbeing trend on an individual response, and the department averages your
            managers see, are calculated from these four answers and nothing else. Comparing this
            month against last month only means something if the question was identical both times.
            If the wording could change, a &ldquo;declining&rdquo; trend might just be a reworded
            question, and a department average might be averaging answers to two different
            questions &mdash; with no way to tell afterwards which had happened. Questions you add
            below appear in the survey and in what your HR Coordinator reads, but they never feed
            those numbers, which is exactly what makes them safe to change whenever you like.
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
      setNotice('Draft saved. Nothing has changed for employees yet — press Publish to send it.')
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
      setNotice(
        `Published version ${version}. Check-ins sent from now on use it; links already in someone's inbox keep the questions they were sent with.`
      )
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
      setNotice(
        `A test check-in is on its way to ${recipientEmail}. It behaves exactly like a real one, and the response it records is excluded from every average and every trend.`
      )
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
        What everyone on your roster is asked at each check-in. Four standard questions are fixed
        for every company; you can add up to {MAX_SUPPLEMENTARY_QUESTIONS} of your own.
      </p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {neverPublished && (
        <Alert variant="warning" title="Nothing published yet">
          Check-ins are not sent until a questionnaire is published, so nobody is being asked
          anything right now. Press Publish below to send the standard questions — with or without
          any of your own.
        </Alert>
      )}

      <CoreQuestionsCard questions={coreQuestions} />

      <Card
        title="Your added questions"
        description={`Optional, and yours to change. These appear in the survey and in what your HR Coordinator reads, but never affect the wellbeing trend or any department average.`}
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleSaveDraft}
              loading={saving}
              loadingLabel="Saving"
              disabled={!unsavedEdits || !draftValid}
            >
              Save draft
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirmPublish(true)}
              disabled={saving || publishing || unsavedEdits || (!unpublishedChanges && !neverPublished)}
            >
              Publish
            </Button>
            {unsavedEdits ? (
              <span className="text-xs text-muted">Unsaved changes — save before publishing.</span>
            ) : unpublishedChanges ? (
              <span className="text-xs text-medium">
                Saved, but not yet sent to anyone. Publish to make it live.
              </span>
            ) : neverPublished ? (
              <span className="text-xs text-muted">Publish to start sending check-ins.</span>
            ) : (
              <span className="text-xs text-muted">Live and up to date.</span>
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
          <Alert variant="warning" title="Do not ask people to name other individuals">
            A question that asks who someone&apos;s problem is with turns a wellness check into an
            informal reporting channel — without any of the protections the case system provides:
            no anonymity, no confidential handling, no investigation process, no retaliation
            follow-up. Answers here are shown to your HR Coordinator attributed to the employee who
            wrote them, by name. Keep these questions about how work feels, and let the reporting
            system handle reports.
          </Alert>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {draft.length} of {MAX_SUPPLEMENTARY_QUESTIONS} used
            </span>
            <Button
              variant="secondary"
              icon="plus"
              onClick={addQuestion}
              disabled={draft.length >= MAX_SUPPLEMENTARY_QUESTIONS}
            >
              Add a question
            </Button>
          </div>

          {draft.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              No added questions. The four standard questions are asked on their own.
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
                          Added question {index + 1}
                        </span>
                        <Button variant="ghost" onClick={() => removeQuestion(q.id)}>
                          Remove
                        </Button>
                      </div>

                      <label className="flex flex-col gap-1.5 text-sm">
                        <span className="font-medium text-charcoal">Question</span>
                        <textarea
                          rows={2}
                          value={q.text}
                          onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                          placeholder="e.g. How clear were your priorities this week?"
                          className={`field ${over ? 'border-critical' : ''}`}
                        />
                        <span className={`text-xs ${over ? 'text-critical' : 'text-muted'}`}>
                          {length} / {MAX_QUESTION_TEXT_LENGTH} characters
                        </span>
                      </label>

                      <div className="sm:max-w-xs">
                        <Select
                          label="Answer type"
                          value={q.type}
                          onChange={(e) => updateQuestion(q.id, { type: e.target.value })}
                        >
                          <option value="scale">{TYPE_LABELS.scale}</option>
                          <option value="freeText">{TYPE_LABELS.freeText}</option>
                        </Select>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {anyEmpty && (
            <p className="text-xs text-critical">Every added question needs some text.</p>
          )}

          {/* Removing a question is forward-only, and saying so here is the
              difference between an admin thinking they have erased something and
              knowing they have not. */}
          {draft.length < publishedSupplementary.length && (
            <Alert variant="info">
              Removing a question stops it being asked from the next publish onwards. Answers
              already given to it are kept, and your HR Coordinator can still read them with the
              question they were answering — old responses are never rewritten.
            </Alert>
          )}
        </div>
      </Card>

      <Card
        title="Preview"
        description="The check-in exactly as employees receive it. This shows what is published and live, not your draft."
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
              loadingLabel="Sending"
            >
              Email me a test check-in
            </Button>
            <span className="text-xs text-muted">
              Sends a real check-in link to your own staff email address, and nowhere else. The
              response it records is marked as a test and never reaches an average or a trend.
            </span>
          </div>

          {publishedAtLabel && (
            <p className="text-xs text-muted">
              <Badge tone="tone-neutral">Version {published.version}</Badge>{' '}
              published {publishedAtLabel}.
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
              Publish this questionnaire?
            </h2>
            <div className="mt-3 flex flex-col gap-2 text-sm text-muted">
              <p>Publishing does four things, and they are worth reading before you press it:</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                <li>
                  It becomes what <strong className="text-charcoal">everyone on your roster</strong>{' '}
                  is asked at every check-in from now on.
                </li>
                <li>
                  It is saved as a permanent version. Old responses keep pointing at the version
                  they answered, so nothing already collected changes meaning.
                </li>
                <li>
                  Check-in links already sitting in someone&apos;s inbox keep the questions they
                  were sent with — they are not switched over mid-flight.
                </li>
                <li>
                  Your name and the time are recorded against it. This is a change to what your
                  whole workforce is asked, so it has an author.
                </li>
              </ul>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmPublish(false)} disabled={publishing}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handlePublish}
                loading={publishing}
                loadingLabel="Publishing"
              >
                Publish
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PulseQuestionsPage
