import { useState } from 'react'
import harassmentQuestions from '../../data/questionnaires/harassment'
import toxicManagementQuestions from '../../data/questionnaires/toxicManagement'
import retaliationQuestions from '../../data/questionnaires/retaliation'
import burnoutQuestions from '../../data/questionnaires/burnout'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import { Select, Textarea } from '../ui/Field'
import { textIndicatesCrisis } from '../shared/crisisTextCheck'
import { validateEvidenceFile } from '../../services/caseThreadService'

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

// A quiet, non-badge marker so a reporter can tell a question is optional
// before they try to answer it, not by hitting a validation error at submit.
function OptionalMarker() {
  return <span className="ml-1.5 text-xs font-normal text-muted">Optional</span>
}

// A long questionnaire read as one continuous column, with nothing marking
// progress inside it. Chunking it into small, visually separate blocks -
// purely presentational, the question set, order, and data collected are
// unchanged - lets it read as a handful of short steps instead of one long
// scroll, which is the difference between "almost done" and "how much is
// left" for someone filling this in under stress.
const BLOCK_SIZE = 3

function chunkQuestions(questions) {
  const blocks = []
  for (let i = 0; i < questions.length; i += BLOCK_SIZE) {
    blocks.push(questions.slice(i, i + BLOCK_SIZE))
  }
  return blocks
}

// A small at-a-glance marker per question so a reporter can scan a block and
// see what's left without reading every answer back. Filled and checked once
// answered, an empty outline otherwise - deliberately not red/error-toned,
// since an unanswered optional question isn't a problem.
function AnsweredMark({ answered }) {
  return (
    <span
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        answered ? 'border-low bg-low text-white' : 'border-line-soft bg-surface'
      }`}
      aria-hidden="true"
    >
      {answered && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
    </span>
  )
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// The optional file-staging step at the end of the questionnaire. Nothing
// here uploads anything - there is no caseId and no passcode yet, since the
// case does not exist until the tier step after this one files it (see
// Submit.jsx / StaffIntakeForm.jsx). Files are held in browser memory only
// and validated against the same rules the server enforces
// (evidenceStorage.js's content-type allowlist and 25MB ceiling), so a file
// that would be rejected later is rejected here instead, with a reason
// attached to it rather than a generic failure after the case already
// exists.
function EvidenceStagingStep({ stagedFiles, onFilesChosen, onRemoveFile, rejections }) {
  return (
    <section className="card flex flex-col gap-4 p-5 sm:p-6">
      <div>
        <p className="text-sm font-medium text-charcoal">
          Attach evidence
          <OptionalMarker />
        </p>
        <p className="mt-1 text-sm text-muted">
          A screenshot, a document, or a photo can identify you even when your written answers
          don't - a filename, the content itself, or details hidden in a photo's file
          information can all carry your name. Attaching anything here is entirely your choice;
          you can also skip this and add files later from your case thread once you have your
          Case ID and passcode.
        </p>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2">
        <span className="btn btn-secondary px-3 py-2 text-xs">
          <Icon name="plus" className="h-3.5 w-3.5" />
          Attach a file
        </span>
        <input type="file" multiple onChange={onFilesChosen} className="sr-only" />
      </label>
      <p className="text-xs text-muted">
        PDF, images, plain text, CSV, or Office documents, up to 25MB each.
      </p>

      {rejections.length > 0 && (
        <Alert variant="error">
          <ul className="flex flex-col gap-1">
            {rejections.map((rejection, index) => (
              <li key={index}>{rejection}</li>
            ))}
          </ul>
        </Alert>
      )}

      {stagedFiles.length > 0 && (
        <ul className="flex flex-col gap-2">
          {stagedFiles.map((staged) => (
            <li
              key={staged.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-line px-3.5 py-2.5 text-sm"
            >
              <span className="min-w-0 truncate text-charcoal">
                {staged.file.name}
                <span className="ml-1.5 text-xs text-muted">{formatFileSize(staged.file.size)}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemoveFile(staged.key)}
                className="shrink-0 text-xs text-muted underline hover:text-charcoal"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
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
// onSubmit(payload): called with { category, responses, files } once every
// question has an answer. `files` is always an array (empty when
// allowEvidenceStaging is off or nothing was staged) - plain browser File
// objects, never uploaded by this component.
// allowEvidenceStaging: shows the optional file-staging step at the end of
// the form. Off by default so a caller that has nowhere to carry staged
// files forward (they'd otherwise be silently dropped) simply never offers
// the option - see Submit.jsx, which turns this on, versus
// StaffIntakeForm.jsx, which doesn't.
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
  allowEvidenceStaging = false,
}) {
  const questions = QUESTIONNAIRES[category]
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [stagedFiles, setStagedFiles] = useState([])
  const [rejections, setRejections] = useState([])

  if (!questions) {
    return <Alert variant="error">Unknown case category.</Alert>
  }

  // Every accepted file is validated the moment it is chosen, not at
  // submission - a rejection has to be legible right next to the file that
  // caused it, before the reporter has moved on to anything else.
  function handleFilesChosen(event) {
    const chosen = Array.from(event.target.files ?? [])
    // Lets the same file be re-selected later (e.g. after removing it) -
    // a file input does not fire onChange again for an unchanged selection.
    event.target.value = ''

    const accepted = []
    const rejected = []
    for (const file of chosen) {
      const reason = validateEvidenceFile(file)
      if (reason) {
        rejected.push(`${file.name}: ${reason}`)
      } else {
        accepted.push({ key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file })
      }
    }
    setStagedFiles((current) => [...current, ...accepted])
    setRejections(rejected)
  }

  function removeStagedFile(key) {
    setStagedFiles((current) => current.filter((staged) => staged.key !== key))
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

    const requiredMissing = questions
      .filter((question) => !question.optional)
      .some((question) => !isAnswered(answers[question.id]))
    if (requiredMissing) {
      setError('Please answer every question before submitting.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit?.({
        category,
        responses: buildResponses(questions, answers),
        files: stagedFiles.map((staged) => staged.file),
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const answeredCount = questions.filter((q) => isAnswered(answers[q.id])).length
  const remaining = questions.length - answeredCount
  const progress = Math.round((answeredCount / questions.length) * 100)
  const blocks = chunkQuestions(questions)

  // Renders just the input for one question - no wrapping block or answered
  // marker, those are the caller's job so every question type shares one
  // scan-and-track treatment regardless of which control it renders.
  function renderQuestionField(question) {
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
          id={question.id}
          label={
            <>
              {question.text}
              {question.optional && <OptionalMarker />}
            </>
          }
          className="min-h-11 py-3"
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
        <fieldset className="flex flex-col gap-2.5">
          <legend className="flex flex-wrap items-center gap-2 text-sm font-medium text-charcoal">
            {question.text}
            {question.optional && <OptionalMarker />}
            {/* A pill, not just hint text below the label - multiselect and
                scale used to read as near-identical option lists. This tags
                "more than one answer" as a property of the question, visible
                before a reporter starts picking, not discovered by trial. */}
            <span className="pill tone-info">Choose all that apply</span>
          </legend>
          <div className="flex flex-col gap-2">
            {question.options.map((option) => {
              const checked = (answers[question.id] ?? []).includes(option.value)
              return (
                <label
                  key={option.value}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm transition-colors ${
                    checked
                      ? 'border-navy bg-navy-50 text-charcoal'
                      : 'border-line bg-surface text-muted hover:border-navy-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMultiselect(question, option.value)}
                    className="sr-only"
                  />
                  {/* A square, not the circular mark scale and single-select
                      use below - the shape itself says "pick any number of
                      these", independent of colour or label text. */}
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      checked ? 'border-navy bg-navy text-white' : 'border-line-soft bg-surface'
                    }`}
                    aria-hidden="true"
                  >
                    {checked && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="text-charcoal">{option.label}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      )
    }

    if (question.type === 'scale') {
      const { min, max, minLabel, maxLabel } = question.options
      // No fallback to `min` here, unlike the old slider - a slider thumb
      // resting at its lowest position still looked answered at a glance,
      // which fought the new answered/unanswered marker. Nothing is
      // highlighted until the reporter actually picks a number.
      const value = answers[question.id]
      const steps = []
      for (let n = min; n <= max; n += 1) steps.push(n)
      const labelId = `${question.id}-label`

      return (
        <div className="flex flex-col gap-2.5">
          <span id={labelId} className="text-sm font-medium text-charcoal">
            {question.text}
            {question.optional && <OptionalMarker />}
          </span>
          {/* A row of numbered buttons, not a slider - a slider is one
              continuous control that reads the same whether it's a scale, a
              volume knob, or a filter. Discrete, tappable numbers make clear
              this is a pick-one scale, and they don't fight a touchscreen the
              way a thin slider thumb does. */}
          <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
            {steps.map((n) => {
              const active = value === n
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setAnswer(question, n)}
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums transition-colors ${
                    active
                      ? 'border-navy bg-navy text-white'
                      : 'border-line bg-surface text-charcoal hover:border-navy-200'
                  }`}
                >
                  {n}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        </div>
      )
    }

    return (
      <Textarea
        id={question.id}
        label={
          <>
            {question.text}
            {question.optional && <OptionalMarker />}
          </>
        }
        className="py-3"
        rows={4}
        value={answers[question.id] ?? ''}
        onChange={(e) => setAnswer(question, e.target.value)}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Progress is worth showing on a form this long - the old version
          gave no sense of how much was left. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {answeredCount} of {questions.length} answered
            {remaining > 0 && <span className="text-muted"> · {remaining} left</span>}
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

      {/* Questions grouped into short blocks rather than one continuous
          column - see chunkQuestions above. Order and membership are
          untouched; this only changes how the same list is laid out. */}
      {blocks.map((block, blockIndex) => (
        <section key={block[0].id} className="card flex flex-col gap-5 p-5 sm:p-6">
          {blocks.length > 1 && (
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              Part {blockIndex + 1} of {blocks.length}
            </p>
          )}
          {block.map((question) => (
            <div key={question.id} className="flex items-start gap-3">
              <AnsweredMark answered={isAnswered(answers[question.id])} />
              <div className="min-w-0 flex-1">{renderQuestionField(question)}</div>
            </div>
          ))}
        </section>
      ))}

      {/* Optional, and at the end of the questionnaire rather than
          alongside any one question - staging evidence isn't part of
          answering, it's a separate thing the reporter may or may not want
          to do before moving on to how they want to be recorded. */}
      {allowEvidenceStaging && (
        <EvidenceStagingStep
          stagedFiles={stagedFiles}
          onFilesChosen={handleFilesChosen}
          onRemoveFile={removeStagedFile}
          rejections={rejections}
        />
      )}

      {error && <Alert variant="error">{error}</Alert>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="min-h-11 self-start"
        loading={submitting}
        loadingLabel="Submitting"
      >
        Continue
      </Button>
    </form>
  )
}

export default QuestionnaireForm
