import { useState } from 'react'
import { Link } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import CategorySelect from '../components/intake/CategorySelect'
import QuestionnaireForm from '../components/intake/QuestionnaireForm'
import { CATEGORIES } from '../data/categories'
import { submitCase } from '../services/caseAccessService'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'

const STEPS = ['Category', 'Details', 'Submit']

// The anonymous reporter's intake flow. CategorySelect and QuestionnaireForm
// collect the report; on the final step it's filed with the submitCase
// callable (functions/src/intake/submitCase.js), which creates the case with
// the category and answers attached and returns the Case ID + one-time
// passcode the reporter needs to track it later.
function Submit() {
  const [category, setCategory] = useState(null)
  const [completed, setCompleted] = useState(null)

  // QuestionnaireForm awaits this and surfaces any thrown error in the form,
  // so a failed submission keeps the reporter on the questionnaire with their
  // answers intact rather than advancing to a success screen.
  async function handleSubmit(submission) {
    const { caseId, passcode } = await submitCase(submission)
    setCompleted({ caseId, passcode, responseCount: submission.responses.length })
  }

  const step = completed ? 2 : category ? 1 : 0
  const categoryLabel = CATEGORIES.find((c) => c.id === category)?.label

  const COPY = [
    {
      title: "What's this report about?",
      description:
        'Choose the category that best fits your situation. The questions that follow are tailored to it.',
    },
    {
      title: 'Tell us what happened',
      description: `${categoryLabel ?? 'Your report'} — answer as much as you can. Everything here stays confidential and is only seen by the handler assigned to your case.`,
    },
    {
      title: 'Report filed',
      description: 'Your report has been submitted. Save your Case ID and passcode below.',
    },
  ][step]

  return (
    <ReporterLayout
      title={COPY.title}
      description={COPY.description}
      steps={STEPS}
      currentStep={step}
      footerNote="Rectifia does not record your name, email, or IP address with this report unless you choose to include it in an answer. Already submitted a report? Track it with your Case ID."
    >
      {step === 0 && <CategorySelect onSelect={setCategory} />}

      {step === 1 && (
        <div className="flex flex-col gap-5">
          <Button icon="back" onClick={() => setCategory(null)} className="self-start">
            Change category
          </Button>
          <div className="card p-6">
            <QuestionnaireForm category={category} onSubmit={handleSubmit} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Alert variant="success" title="Your report has been filed">
            Write down your Case ID and passcode now — they are shown only once and cannot be
            recovered. You'll need both to track your case.
          </Alert>

          <div className="card p-6">
            <dl className="flex flex-col gap-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Case ID</dt>
                <dd className="mt-1 select-all font-mono text-lg font-semibold text-charcoal">
                  {completed.caseId}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Passcode</dt>
                <dd className="mt-1 select-all font-mono text-lg font-semibold text-charcoal">
                  {completed.passcode}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted">
              {completed.responseCount} answer
              {completed.responseCount === 1 ? '' : 's'} recorded for {categoryLabel}.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setCompleted(null)
                  setCategory(null)
                }}
              >
                Start over
              </Button>
              <Link to="/case" className="btn btn-secondary">
                Track an existing case
              </Link>
            </div>
          </div>
        </div>
      )}
    </ReporterLayout>
  )
}

export default Submit
