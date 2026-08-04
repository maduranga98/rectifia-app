import { useState } from 'react'
import { submitPulseResponse } from '../../services/pulseCheckService'
import { auth } from '../../services/firebase'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Textarea } from '../ui/Field'

// Wellness questions only - no case content, no reference to the anonymous
// reporting system anywhere in this form. Submission requires the employee
// to be signed in (auth.currentUser) - that's the whole point of keeping
// Pulse Check structurally separate from the anonymous case system, which
// has no auth path at all.
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

function PulseSurveyForm({ companyId, department, onSubmitted }) {
  const [values, setValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const answers = QUESTIONS.map((q) => ({ questionId: q.id, value: values[q.id] ?? '' })).filter(
        (a) => a.value !== ''
      )
      await submitPulseResponse({ companyId, department, answers })
      setSubmitted(true)
      onSubmitted?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!auth.currentUser) {
    return (
      <Card padded={false} className="mx-auto max-w-lg">
        <EmptyState
          icon="pulse"
          title="Sign in to complete this pulse check"
          description="Pulse checks are tied to your staff account, unlike anonymous case reports."
        />
      </Card>
    )
  }

  if (submitted) {
    return (
      <Card padded={false} className="mx-auto max-w-lg">
        <EmptyState
          icon="check"
          title="Thanks - your response has been submitted"
          description="Your answers feed the aggregate wellbeing picture for your department."
        />
      </Card>
    )
  }

  return (
    <Card
      title="Pulse check"
      description="A few quick questions about how work is going. Takes under a minute."
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
              onChange={(e) => setValues({ ...values, [q.id]: e.target.value })}
            />
          ) : (
            <ScaleInput
              key={q.id}
              question={q}
              value={values[q.id]}
              onChange={(value) => setValues({ ...values, [q.id]: value })}
            />
          )
        )}

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
