import { useState } from 'react'
import harassmentQuestions from '../../data/questionnaires/harassment'
import toxicManagementQuestions from '../../data/questionnaires/toxicManagement'
import retaliationQuestions from '../../data/questionnaires/retaliation'
import burnoutQuestions from '../../data/questionnaires/burnout'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import { Select, Textarea } from '../ui/Field'
import { textIndicatesCrisis } from '../shared/crisisTextCheck'

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

// The sentinel option value for a companyDepartments select's "I'd rather not
// say" choice. Never persisted - the select's onChange below stores `null` as
// the answer instead, the same value an unanswered department question would
// carry downstream, since a DOM <select> can only ever hand back a string.
const NOT_SPECIFIED_OPTION = '__not_specified__'

// Builds the option list for a question whose options aren't baked into the
// static questionnaire definition (see harassment.js's subject_department for
// why: it has to be the company's own department list, not free text). The
// questionnaire files stay company-agnostic - this is the one place that
// resolves them against the company passed into the form.
function companyDepartmentOptions(departments) {
  return [
    ...(departments ?? []).map((department) => ({
      value: department.name,
      label: department.name,
    })),
    { value: NOT_SPECIFIED_OPTION, label: "I'd rather not say" },
  ]
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
// server-side detector - no server detection happens here.
// onCrisisResourcesTrigger(): optional, fired the first time the lightweight
// client-side check trips on a `triggersCrisisCheck` field. This is the
// reporter-facing half: it lets the page offer support resources in the
// moment, entirely in the browser, without waiting for the server's crisisFlag
// (which only arrives after submission). The partial draft is never sent
// anywhere for this - see crisisTextCheck.js. Whether the resources were shown
// is deliberately not recorded anywhere.
function QuestionnaireForm({
  category,
  departments = [],
  onSubmit,
  onCrisisCheckField,
  onCrisisResourcesTrigger,
}) {
  const questions = QUESTIONNAIRES[category]
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (!questions) {
    return <Alert variant="error">Unknown case category.</Alert>
  }

  function setAnswer(question, value) {
    setAnswers((current) => ({ ...current, [question.id]: value }))
    if (question.triggersCrisisCheck) {
      onCrisisCheckField?.(question.id, value)
      // The lightweight, in-browser check. Runs on the value already in hand;
      // nothing is transmitted for it. Once tripped we signal the page, which
      // decides how to surface resources - showing them must never interrupt
      // or gate what the reporter is doing.
      if (textIndicatesCrisis(value)) {
        onCrisisResourcesTrigger?.()
      }
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

    const requiredMissing = questions.some((question) => !isAnswered(answers[question.id]))
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

  const answeredCount = questions.filter((q) => isAnswered(answers[q.id])).length
  const progress = Math.round((answeredCount / questions.length) * 100)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Progress is worth showing on a form this long - the old version
          gave no sense of how much was left. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {answeredCount} of {questions.length} answered
          </span>
          <span className="tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
          <div
            className="h-full rounded-full bg-navy transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {questions.map((question) => {
        if (question.type === 'select') {
          const isCompanyDepartmentSelect = question.dynamicOptions === 'companyDepartments'
          const options = isCompanyDepartmentSelect
            ? companyDepartmentOptions(departments)
            : question.options
          const answer = answers[question.id]
          // A department answer of `null` ("I'd rather not say") has to render
          // as that option, not fall back to the disabled placeholder - `??`
          // alone would show the select as unanswered even though it has one.
          const selectValue = isCompanyDepartmentSelect && answer === null ? NOT_SPECIFIED_OPTION : answer ?? ''

          return (
            <Select
              key={question.id}
              id={question.id}
              label={question.text}
              value={selectValue}
              onChange={(e) => {
                const raw = e.target.value
                if (isCompanyDepartmentSelect && raw === NOT_SPECIFIED_OPTION) {
                  setAnswer(question, null)
                } else {
                  setAnswer(question, raw)
                }
              }}
            >
              <option value="" disabled>
                Select an answer
              </option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )
        }

        if (question.type === 'multiselect') {
          return (
            <fieldset key={question.id} className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-charcoal">{question.text}</legend>
              <p className="text-xs text-muted">Select all that apply.</p>
              <div className="mt-1 flex flex-col gap-2">
                {question.options.map((option) => {
                  const checked = (answers[question.id] ?? []).includes(option.value)
                  return (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                        checked
                          ? 'border-navy bg-navy-50 text-charcoal'
                          : 'border-line bg-surface text-muted hover:border-navy-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMultiselect(question, option.value)}
                        className="h-4 w-4"
                      />
                      <span className="text-charcoal">{option.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )
        }

        if (question.type === 'scale') {
          const value = answers[question.id] ?? question.options.min
          return (
            <div key={question.id} className="flex flex-col gap-2">
              <label htmlFor={question.id} className="text-sm font-medium text-charcoal">
                {question.text}
              </label>
              <div className="flex items-center gap-3">
                <input
                  id={question.id}
                  type="range"
                  min={question.options.min}
                  max={question.options.max}
                  value={value}
                  onChange={(e) => setAnswer(question, Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-8 shrink-0 text-center text-sm font-semibold tabular-nums text-navy">
                  {value}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted">
                <span>{question.options.minLabel}</span>
                <span>{question.options.maxLabel}</span>
              </div>
            </div>
          )
        }

        return (
          <Textarea
            key={question.id}
            id={question.id}
            label={question.text}
            rows={4}
            value={answers[question.id] ?? ''}
            onChange={(e) => setAnswer(question, e.target.value)}
          />
        )
      })}

      {error && <Alert variant="error">{error}</Alert>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="self-start"
        loading={submitting}
        loadingLabel="Submitting"
      >
        Continue
      </Button>
    </form>
  )
}

export default QuestionnaireForm
