import { useState } from 'react'
import { submitPulseResponse } from '../../services/pulseCheckService'
import { sortQuestions } from '../../services/pulseQuestionService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import CrisisResources from '../shared/CrisisResources'
import { textIndicatesCrisis } from '../shared/crisisTextCheck'
import EmptyState from '../ui/EmptyState'
import { Textarea } from '../ui/Field'

// Wellness questions only - no case content, no reference to the anonymous
// reporting system anywhere in this form. Access is the single-use invite
// token (inviteId + token), NOT a signed-in account: the people this form
// targets are roster employees who have no staff account at all, so there is
// deliberately no auth.currentUser check here. companyId, department and
// employeeId are never taken from this form - the server reads them off the
// invite when the token is spent.
//
// The questions themselves are no longer defined here. This form used to carry
// its own QUESTIONS const, which made the client the only place the
// questionnaire existed: nothing else could show it, nothing validated against
// it, and the server stored whatever answers it was handed. The set now arrives
// resolved from the server (validatePulseInvite returns it alongside the invite
// check, so it is one round trip), stamped with the version this specific
// invite was minted against - so an employee holding a link sent before a
// publish answers the questionnaire they were actually sent.

// Rendered when the scale labels are missing for some reason; the server always
// sends them for a scale question, so this is belt-and-braces rather than a
// real fallback path.
const DEFAULT_SCALE_LABELS = ['Not at all', 'Rarely', 'Somewhat', 'Mostly', 'Very much']

// A five-point scale is a scale, not a dropdown: showing all five options at
// once is one glance instead of a click, and it makes the midpoint visible.
// The labels come from the question itself now, so a scale rendered here always
// matches the one the server will validate the answer against.
function ScaleInput({ question, value, onChange, disabled }) {
  const labels = question.scaleLabels?.length ? question.scaleLabels : DEFAULT_SCALE_LABELS
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-charcoal">{question.text}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {labels.map((label, index) => {
          const optionValue = String(index + 1)
          const selected = value === optionValue
          return (
            <label
              key={optionValue}
              className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-center transition-colors ${
                disabled ? 'cursor-default' : 'cursor-pointer'
              } ${
                selected
                  ? 'border-navy bg-navy text-white'
                  : 'border-line bg-surface text-muted hover:border-navy-200 hover:bg-navy-50'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                value={optionValue}
                checked={selected}
                onChange={(e) => onChange(e.target.value)}
                className="sr-only"
              />
              <span className="text-base font-semibold">{optionValue}</span>
              <span className="text-[0.6875rem] leading-tight">{label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

// Spelled out on screen, not just in a policy doc: this is the module's trust
// contract, and an employee deciding how candid to be deserves to see exactly
// who reads what before they answer and again after they submit.
function WhoSeesThis() {
  return (
    <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted">
      <li>
        Your <strong className="font-medium text-charcoal">HR Coordinator</strong> and{' '}
        <strong className="font-medium text-charcoal">Pulse Check Reviewer</strong> can see your
        individual response.
      </li>
      <li>
        Your <strong className="font-medium text-charcoal">manager</strong> sees department-level
        aggregates only - never your individual answers.
      </li>
    </ul>
  )
}

// `preview` renders the real form - real layout, real scale, inputs you can
// actually click - with submission disabled. It is what PulseQuestionsPage and
// the HR-side read-only view show; see QuestionSetPreview.jsx, which is the only
// thing that should pass it.
function PulseSurveyForm({ inviteId, token, companyName, questionSet, onSubmitted, preview = false }) {
  const [values, setValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  // Sticky, in-tab only. Free-text answers are checked in the browser as they
  // are typed; nothing about them, and nothing about this panel being shown, is
  // ever sent to a server or recorded. (analyzePulseResponse.js does its own
  // server-side crisisFlag detection after submission, untouched by this - this
  // is the reporter-facing half that offers help in the moment.)
  const [showResources, setShowResources] = useState(false)

  const company = companyName || 'your organization'
  const questions = sortQuestions(questionSet?.questions)

  function handleChange(question, value) {
    setValues({ ...values, [question.id]: value })
    // EVERY free-text question is checked, not just the core "anything else"
    // one. A company that adds a free-text question must not be able to create
    // a path where someone writes something that needs help and is shown none.
    if (question.type === 'freeText' && textIndicatesCrisis(value)) {
      setShowResources(true)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    // Belt-and-braces: the submit button is disabled in preview mode, so this
    // is the second of two independent reasons nothing is ever recorded from a
    // preview.
    if (preview) return
    setSubmitting(true)
    setError(null)
    try {
      const answers = questions
        .map((q) => ({ questionId: q.id, value: values[q.id] ?? '' }))
        .filter((a) => a.value !== '')
      await submitPulseResponse({ inviteId, token, answers })
      setSubmitted(true)
      onSubmitted?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <Card className="mx-auto max-w-lg">
        <div className="flex flex-col gap-4">
          <EmptyState
            icon="check"
            title="Thanks - your response has been recorded"
            description={`Your check-in for ${company} has been saved.`}
          />
          <div className="rounded-lg border border-line bg-navy-50 p-4">
            <p className="mb-2 text-sm font-medium text-charcoal">Who sees your response</p>
            <WhoSeesThis />
          </div>

          {showResources && <CrisisResources />}
        </div>
      </Card>
    )
  }

  // A question set that resolved to nothing at all would leave an employee
  // staring at a Submit button with no questions above it. Core is always
  // answerable server-side, so this only happens if the set failed to load.
  if (questions.length === 0) {
    return (
      <Card padded={false} className="mx-auto max-w-lg">
        <EmptyState
          icon="alert"
          title="This check-in couldn't be loaded"
          description="The questions didn't load. Please try opening your link again in a few minutes - nothing is wrong with your link."
        />
      </Card>
    )
  }

  return (
    <Card
      title="Pulse check"
      description={`A few quick questions about how work is going at ${company}. Takes under a minute.`}
      className="mx-auto max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {preview && (
          <Alert variant="info" title="Preview - nothing is recorded">
            This is exactly what employees see. You can click through the scale and type in the
            boxes; nothing you enter here is saved, sent, or counted anywhere.
          </Alert>
        )}

        {questions.map((q) =>
          q.type === 'freeText' ? (
            <Textarea
              key={q.id}
              label={q.text}
              rows={3}
              value={values[q.id] ?? ''}
              onChange={(e) => handleChange(q, e.target.value)}
            />
          ) : (
            <ScaleInput
              key={q.id}
              question={q}
              value={values[q.id]}
              onChange={(value) => handleChange(q, value)}
            />
          )
        )}

        {/* Appears the moment the in-browser check trips, without gating the
            check-in. Pulse checks never learn a jurisdiction here, so every
            regional route plus the international fallback is offered. */}
        {showResources && <CrisisResources />}

        <div className="rounded-lg border border-line bg-navy-50 p-4">
          <p className="mb-2 text-sm font-medium text-charcoal">Who sees your response</p>
          <WhoSeesThis />
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={submitting}
          loadingLabel="Submitting"
          disabled={preview}
        >
          {preview ? 'Submit (disabled in preview)' : 'Submit'}
        </Button>
      </form>
    </Card>
  )
}

export default PulseSurveyForm
