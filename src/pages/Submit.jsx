import { useState } from 'react'
import { Link } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import CategorySelect from '../components/intake/CategorySelect'
import QuestionnaireForm from '../components/intake/QuestionnaireForm'
import { CATEGORIES } from '../data/categories'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'

const STEPS = ['Category', 'Details', 'Submit']

// The anonymous reporter's intake flow. CategorySelect and
// QuestionnaireForm were both already built but had no page rendering them,
// so /submit was a bare heading; this wires them into the two-step flow
// they were written for.
//
// Filing the completed report is not wired up: there is no case-creation
// callable in functions/ yet (generateCaseAccess, caseThread, routeCase and
// the rest all assume a case document that already exists), and inventing a
// Case ID here would hand the reporter a reference that resolves to
// nothing. The answers stay on screen and the last step says so plainly
// rather than reporting a success that didn't happen.
function Submit() {
  const [category, setCategory] = useState(null)
  const [completed, setCompleted] = useState(null)

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
      title: 'Ready to file',
      description: 'Your answers are complete.',
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
            <QuestionnaireForm category={category} onSubmit={setCompleted} />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Alert variant="warning" title="Submission is not available yet">
            Your answers are complete, but this deployment has no case-intake endpoint connected,
            so the report has not been filed and no Case ID has been issued. Nothing you entered
            has been sent anywhere.
          </Alert>

          <div className="card p-6">
            <p className="text-sm font-medium text-charcoal">
              {completed.responses.length} answer
              {completed.responses.length === 1 ? '' : 's'} recorded for {categoryLabel}
            </p>
            <p className="mt-1 text-sm text-muted">
              Keep this window open if you want to copy anything out before leaving.
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
