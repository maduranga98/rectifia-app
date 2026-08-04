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
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
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

  // The tracking address for this specific case, shown as text the reporter
  // can write down or bookmark. The Case ID in the path pre-fills the access
  // form; the passcode is never in the URL, so the link on its own opens
  // nothing.
  const trackingUrl =
    completed && typeof window !== 'undefined'
      ? `${window.location.origin}/case/${completed.caseId}`
      : null

  async function copyTrackingUrl() {
    if (!trackingUrl) return
    setCopied(false)
    setCopyFailed(false)
    try {
      // Absent over plain http and in some embedded browsers - exactly the
      // contexts a reporter on a shared or locked-down device is likely to
      // be in. The URL stays selectable above either way.
      await navigator.clipboard.writeText(trackingUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
    }
  }

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
      // Two steps hold something that only exists in this tab: the answers
      // on step 1 (nothing filed yet, all of it in QuestionnaireForm state)
      // and the credentials on step 2 (shown once, never recoverable). The
      // header's tracking link asks before it takes either away.
      unsavedWarning={
        step === 1
          ? 'Leaving now discards the answers you have entered - this report has not been submitted yet and nothing is saved. Continue to case tracking?'
          : step === 2
            ? 'Have you saved your Case ID and passcode? They are shown only on this screen and cannot be recovered afterwards. Continue to case tracking?'
            : undefined
      }
      footerNote="Rectifia does not record your name, email, or IP address with this report unless you choose to include it in an answer."
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

      {/* This screen is the only time these credentials exist anywhere the
          reporter can see them: the passcode is stored hashed and the case
          has no owner to prove identity against, so nothing here can be
          re-issued or emailed later. It is worth the space it takes. */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Alert variant="success" title="Your report has been filed">
            {completed.responseCount} answer
            {completed.responseCount === 1 ? '' : 's'} recorded for {categoryLabel}. Save the
            details below before you close this page.
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
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Where to check on your case
                </dt>
                <dd className="mt-1 flex flex-col gap-2">
                  {/* Spelled out rather than hidden behind a link label: a
                      reporter writing this on paper or photographing the
                      screen needs the characters, not a click target. */}
                  <code className="block select-all break-all rounded-md border border-line bg-line-soft px-3 py-2 text-xs text-charcoal">
                    {trackingUrl}
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button icon="document" onClick={copyTrackingUrl}>
                      {copied ? 'Copied' : 'Copy link'}
                    </Button>
                    {copyFailed && (
                      <span className="text-xs text-muted">
                        Couldn&apos;t copy automatically — select the link above and copy it.
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    The link opens the tracking form with your Case ID filled in. It does not
                    contain your passcode — you will still be asked for it.
                  </p>
                </dd>
              </div>
            </dl>
          </div>

          <Alert variant="warning" title="Your passcode cannot be recovered">
            It is stored only as a hash, so no one — not Rectifia, not your employer, not the
            handler on your case — can look it up, reset it, or send it to you. There is no
            account and no email address attached to this report to recover it to.{' '}
            <strong className="font-semibold">
              If you lose the Case ID or passcode, you permanently lose access to this case
            </strong>{' '}
            and its messages, and filing a new report is the only way to be heard again.
          </Alert>

          <div className="card p-6">
            <h2 className="text-sm font-semibold text-charcoal">Before you leave this page</h2>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted">
              <li>Bookmark the link above, or screenshot this screen.</li>
              <li>
                Write the passcode somewhere only you can reach — a screenshot on a work device
                may not be private.
              </li>
              <li>Come back any time to read replies from your handler and answer them.</li>
            </ul>
            <div className="mt-4">
              <Button
                onClick={() => {
                  setCompleted(null)
                  setCategory(null)
                  setCopied(false)
                  setCopyFailed(false)
                }}
              >
                File another report
              </Button>
            </div>
          </div>
        </div>
      )}
    </ReporterLayout>
  )
}

export default Submit
