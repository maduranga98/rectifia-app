import { useState } from 'react'
import { submitPulseResponse } from '../../services/pulseCheckService'
import { auth } from '../../services/firebase'

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

function PulseSurveyForm({ companyId, department, onSubmitted }) {
  const [values, setValues] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)

  if (!auth.currentUser) {
    return <p className="p-6 text-sm text-gray-500">Sign in to complete this pulse check.</p>
  }

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

  if (submitted) {
    return <p className="p-6 text-sm text-green-600">Thanks - your response has been submitted.</p>
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Pulse check</h1>

      {QUESTIONS.map((q) => (
        <label key={q.id} className="flex flex-col gap-1 text-sm">
          {q.label}
          {q.freeText ? (
            <textarea
              rows={3}
              value={values[q.id] ?? ''}
              onChange={(e) => setValues({ ...values, [q.id]: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2"
            />
          ) : (
            <select
              value={values[q.id] ?? ''}
              onChange={(e) => setValues({ ...values, [q.id]: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select...</option>
              <option value="1">1 - Not at all</option>
              <option value="2">2</option>
              <option value="3">3 - Somewhat</option>
              <option value="4">4</option>
              <option value="5">5 - Very much</option>
            </select>
          )}
        </label>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  )
}

export default PulseSurveyForm
