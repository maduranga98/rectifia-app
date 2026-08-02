import { useState } from 'react'
import harassmentQuestions from '../../data/questionnaires/harassment'
import toxicManagementQuestions from '../../data/questionnaires/toxicManagement'
import retaliationQuestions from '../../data/questionnaires/retaliation'
import burnoutQuestions from '../../data/questionnaires/burnout'

const QUESTIONNAIRES = {
  harassment: harassmentQuestions,
  toxicManagement: toxicManagementQuestions,
  retaliation: retaliationQuestions,
  burnout: burnoutQuestions,
}

function optionWeight(options, value) {
  const match = options?.find((option) => option.value === value)
  return match ? match.severityWeight : null
}

function isAnswered(value) {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
}

// Turns raw form answers into the structured shape module 6 consumes: each
// answered question paired with its type and whatever severity-weight
// metadata applies to the chosen answer(s). No score is computed here - the
// weights are passed through as-is for module 6 to interpret. Questions
// marked `triggersCrisisCheck` are flagged as `crisisCheckCandidate` so
// module 6 knows which free-text answers to scan; this module never
// inspects the text itself.
function buildResponses(questions, answers) {
  return questions
    .filter((question) => isAnswered(answers[question.id]))
    .map((question) => {
      const value = answers[question.id]
      let severityWeight = null

      if (question.type === 'select') {
        severityWeight = optionWeight(question.options, value)
      } else if (question.type === 'multiselect') {
        severityWeight = value.map((v) => optionWeight(question.options, v))
      } else if (question.type === 'scale') {
        severityWeight = question.severityWeight
      }

      const response = {
        questionId: question.id,
        type: question.type,
        value,
        severityWeight,
      }

      if (question.triggersCrisisCheck) {
        response.crisisCheckCandidate = true
      }

      return response
    })
}

// category: one of the keys in QUESTIONNAIRES (see CategorySelect.jsx).
// onSubmit(payload): called with { category, responses } once every
// question has an answer.
// onCrisisCheckField(questionId, value): optional, fired on every change to
// a `triggersCrisisCheck` field. This is only a wiring point for module 6's
// detector - no detection happens here.
function QuestionnaireForm({ category, onSubmit, onCrisisCheckField }) {
  const questions = QUESTIONNAIRES[category]
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (!questions) {
    return <p className="p-8 text-sm text-red-600">Unknown case category.</p>
  }

  function setAnswer(question, value) {
    setAnswers((current) => ({ ...current, [question.id]: value }))
    if (question.triggersCrisisCheck) {
      onCrisisCheckField?.(question.id, value)
    }
  }

  function toggleMultiselect(question, optionValue) {
    const current = answers[question.id] ?? []
    const next = current.includes(optionValue)
      ? current.filter((value) => value !== optionValue)
      : [...current, optionValue]
    setAnswer(question, next)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    const requiredMissing = questions.some(
      (question) => !isAnswered(answers[question.id])
    )
    if (requiredMissing) {
      setError('Please answer every question before submitting.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit?.({
        category,
        responses: buildResponses(questions, answers),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">Tell us what happened</h1>

      {questions.map((question) => (
        <div key={question.id}>
          <label htmlFor={question.id} className="block text-sm font-medium">
            {question.text}
          </label>

          {question.type === 'select' && (
            <select
              id={question.id}
              value={answers[question.id] ?? ''}
              onChange={(e) => setAnswer(question, e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="" disabled>
                Select an answer
              </option>
              {question.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          {question.type === 'multiselect' && (
            <div className="mt-2 space-y-2">
              {question.options.map((option) => (
                <label key={option.value} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={(answers[question.id] ?? []).includes(option.value)}
                    onChange={() => toggleMultiselect(question, option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          )}

          {question.type === 'scale' && (
            <div className="mt-2">
              <input
                id={question.id}
                type="range"
                min={question.options.min}
                max={question.options.max}
                value={answers[question.id] ?? question.options.min}
                onChange={(e) => setAnswer(question, Number(e.target.value))}
                className="w-full"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>{question.options.minLabel}</span>
                <span>{question.options.maxLabel}</span>
              </div>
            </div>
          )}

          {question.type === 'text' && (
            <textarea
              id={question.id}
              value={answers[question.id] ?? ''}
              onChange={(e) => setAnswer(question, e.target.value)}
              rows={4}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          )}
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Continue'}
      </button>
    </form>
  )
}

export default QuestionnaireForm
