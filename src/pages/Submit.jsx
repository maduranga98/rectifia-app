import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import CategorySelect from '../components/intake/CategorySelect'
import QuestionnaireForm from '../components/intake/QuestionnaireForm'
import { CATEGORIES } from '../data/categories'
import { resolveCompanySlug, submitCase } from '../services/caseAccessService'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'

const STEPS = ['Category', 'Details', 'Submit']

// The anonymous reporter's intake flow. The report is company-scoped: the
// :companySlug in the URL is resolved to a company (server-side, via the
// resolveCompanySlug callable) before any category is shown, so a report can
// only ever be filed against a real company. CategorySelect and
// QuestionnaireForm then collect the report; on the final step it's filed with
// the submitCase callable (functions/src/intake/submitCase.js) - the slug goes
// along and is re-resolved to a companyId there so the client can't spoof which
// company a case lands in. submitCase returns the Case ID + one-time passcode
// the reporter needs to track it later.
function Submit() {
  const { companySlug } = useParams()
  const [category, setCategory] = useState(null)
  const [completed, setCompleted] = useState(null)
  // The last settled slug lookup, tagged with the slug it was for. Tagging lets
  // us treat a result from a previous slug as "still loading" once the slug in
  // the URL changes, without having to synchronously reset state in the effect.
  const [resolution, setResolution] = useState(null)

  useEffect(() => {
    let active = true
    resolveCompanySlug(companySlug)
      .then((result) => {
        if (active) setResolution({ slug: companySlug, company: result, error: null })
      })
      .catch((err) => {
        if (active) setResolution({ slug: companySlug, company: null, error: err.message })
      })
    return () => {
      active = false
    }
  }, [companySlug])

  // Only trust a resolution that matches the slug currently in the URL.
  const resolved = resolution?.slug === companySlug ? resolution : null
  const company = resolved?.company ?? null
  const resolveError = resolved?.error ?? null

  // QuestionnaireForm awaits this and surfaces any thrown error in the form,
  // so a failed submission keeps the reporter on the questionnaire with their
  // answers intact rather than advancing to a success screen. The slug travels
  // with the submission so the server can bind the case to this company.
  async function handleSubmit(submission) {
    const { caseId, passcode } = await submitCase({ ...submission, companySlug })
    setCompleted({ caseId, passcode, responseCount: submission.responses.length })
  }

  // The slug hasn't resolved yet - show a neutral loading state rather than
  // flashing the category screen for a link that may turn out to be invalid.
  if (!resolveError && company === null) {
    return (
      <ReporterLayout title="Loading…" description="Checking your reporting link.">
        <div className="card p-6 text-sm text-muted">One moment…</div>
      </ReporterLayout>
    )
  }

  // Either the lookup failed to run, or it ran and the slug belongs to no
  // company. Both mean the reporter can't file here - show a clear message,
  // never a blank form that would silently discard their report.
  if (resolveError || !company?.found) {
    return (
      <ReporterLayout
        title="This reporting link isn't valid"
        description="We couldn't find the company for this link."
      >
        <Alert variant="error" title="Reporting link not recognised">
          The link you followed doesn't point to a company that accepts reports through Rectifia.
          Double-check the address, or ask whoever shared it for a current one.
          {resolveError && (
            <p className="mt-2 text-xs">If this keeps happening, the reporting service may be temporarily unavailable.</p>
          )}
        </Alert>
        <div className="mt-4">
          <Link to="/case" className="btn btn-secondary">
            Track an existing case
          </Link>
        </div>
      </ReporterLayout>
    )
  }

  const step = completed ? 2 : category ? 1 : 0
  const categoryLabel = CATEGORIES.find((c) => c.id === category)?.label

  const COPY = [
    {
      title: "What's this report about?",
      description: `${
        company.companyName ? `Reporting to ${company.companyName}. ` : ''
      }Choose the category that best fits your situation. The questions that follow are tailored to it.`,
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
