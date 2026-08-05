import { useState } from 'react'
import { submitPulseResponse } from '../../services/pulseCheckService'
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
const QUESTIONS = [
  { id: 'workload', label: 'How manageable has your workload felt this week?' },
  { id: 'support', label: 'How supported do you feel by your manager/team?' },
  { id: 'wellbeing', label: 'How would you describe your overall wellbeing right now?' },
  { id: 'comments', label: 'Anything else you want to share?', freeText: true },
]

const SCALE = [
  { value: '1', label: 'Not at all' },
  { value: '2', label: 'Rarely' },
  { value: '3', label: 'Somewhat' },
  { value: '4', label: 'Mostly' },
  { value: '5', label: 'Very much' },
]

// A five-point scale is a scale, not a dropdown: showing all five options at
// once is one glance instead of a click, and it makes the midpoint visible.
function ScaleInput({ question, value, onChange }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-charcoal">{question.label}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {SCALE.map((option) => {
          const selected = value === option.value
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-center transition-colors ${
                selected
                  ? 'border-navy bg-navy text-white'
                  : 'border-line bg-surface text-muted hover:border-navy-200 hover:bg-navy-50'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={selected}
                onChange={(e) => onChange(e.target.value)}
                className="sr-only"
              />
              <span className="text-base font-semibold">{option.value}</span>
              <span className="text-[0.6875rem] leading-tight">{option.label}</span>
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

function PulseSurveyForm({ inviteId, token, companyName, onSubmitted }) {
  const [values, setValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  // Sticky, in-tab only. The free-text answer is checked in the browser as it
  // is typed; nothing about it, and nothing about this panel being shown, is
  // ever sent to a server or recorded. (analyzePulseResponse.js does its own
  // server-side crisisFlag detection after submission, untouched by this - this
  // is the reporter-facing half that offers help in the moment.)
  const [showResources, setShowResources] = useState(false)

  const company = companyName || 'your organization'

  function handleChange(question, value) {
    setValues({ ...values, [question.id]: value })
    if (question.freeText && textIndicatesCrisis(value)) {
      setShowResources(true)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const answers = QUESTIONS.map((q) => ({ questionId: q.id, value: values[q.id] ?? '' })).filter(
        (a) => a.value !== ''
      )
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

  return (
    <Card
      title="Pulse check"
      description={`A few quick questions about how work is going at ${company}. Takes under a minute.`}
      className="mx-auto max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {QUESTIONS.map((q) =>
          q.freeText ? (
            <Textarea
              key={q.id}
              label={q.label}
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
        >
          Submit
        </Button>
      </form>
    </Card>
  )
}

export default PulseSurveyForm
