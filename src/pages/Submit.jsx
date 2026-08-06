import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReporterLayout from '../components/shared/ReporterLayout'
import CategorySelect from '../components/intake/CategorySelect'
import QuestionnaireForm from '../components/intake/QuestionnaireForm'
import CrisisResources from '../components/shared/CrisisResources'
import CaseNotificationOptIn from '../components/intake/CaseNotificationOptIn'
import { CATEGORIES } from '../data/categories'
import { resolveCompanySlug, submitCase } from '../services/caseAccessService'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import Icon from '../components/ui/Icon'

const STEPS = ['Category', 'Details', 'Your choice', 'Submit']

// The two tiers in the words the reporter is actually asked them in. This is
// the reporter's own decision and the last thing they are asked before the
// report is filed, deliberately: a choice this consequential should not be
// buried at the top of a form nobody has started filling in yet, and by this
// point they know what they are about to hand over.
//
// The same copy is shown to staff taking a report by phone (see TIERS in
// src/services/staffIntakeService.js), because a reporter's answer only means
// anything if it was the same question. The anonymity trade-off is stated
// plainly rather than sold - "some investigations are harder to complete" is
// true, and a reporter who finds that out afterwards was misled.
const REPORTER_TIERS = [
  {
    value: 'anonymous',
    label: 'Stay anonymous',
    summary: 'Nobody can ever identify you.',
    detail:
      'No name, email, or phone number is recorded anywhere on this report - not encrypted, not stored blank, simply never collected. Nobody at your employer, nobody at Rectifia, and nobody with a court order can look you up afterwards. You can still read replies and answer questions using your Case ID and passcode. Be aware that some investigations are harder to complete this way, and a few cannot be resolved at all, because the investigator has no way to come back to you for the detail they need.',
  },
  {
    value: 'confidential',
    label: 'Be identifiable to the investigator only',
    summary: 'Only the person assigned to your case sees who you are.',
    detail:
      "Choosing this records your choice - it does not collect anything yet. You are not asked for your details on this screen. When you open your case, you'll be able to give the investigator your name, email, phone, or whatever you're willing to share; it is encrypted the moment you submit it, and never appears on any dashboard, in any report, or to anyone else at your employer. The investigator can come back to you with follow-up questions once you do, which usually makes a case easier to resolve. Nothing requires you to do this by a deadline, and leaving it blank is a choice you can make too.",
  },
]

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
  // The completed questionnaire, held in this tab only, between the answers
  // being finished and the tier being chosen. Nothing is filed until both.
  const [pending, setPending] = useState(null)
  const [tier, setTier] = useState('')
  const [filing, setFiling] = useState(false)
  const [fileError, setFileError] = useState(null)
  const [completed, setCompleted] = useState(null)
  // Sticky: once the in-browser crisis check has tripped, support resources
  // stay offered for the rest of this session, including on the confirmation
  // screen if the report was filed under that condition. This lives only in
  // this tab's memory - it is never written to the case, sent to a server, or
  // logged. That a reporter saw the resources must not become a readable
  // signal about them anywhere.
  const [crisisTriggered, setCrisisTriggered] = useState(false)
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

  // The questionnaire hands its answers back here rather than filing them:
  // `tier` has to be on the case document when it is created (scoreCase.js
  // fires on create, and generateReport.js keys its identity section on it),
  // so the reporter is asked how they want to be recorded before anything is
  // written, not after.
  async function handleQuestionnaireSubmit(submission) {
    setPending(submission)
  }

  async function handleFile(chosenTier) {
    setFiling(true)
    setFileError(null)
    try {
      const { caseId, passcode } = await submitCase({
        ...pending,
        companySlug,
        tier: chosenTier,
      })
      setCompleted({ caseId, passcode, responseCount: pending.responses.length })
    } catch (err) {
      // Stay on the tier step with the answers intact - they exist only in
      // this tab, and nothing has been filed yet.
      setFileError(err.message)
    } finally {
      setFiling(false)
    }
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

  const step = completed ? 3 : pending ? 2 : category ? 1 : 0
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
      title: 'One last choice — how should we record you?',
      description:
        'Your answers are ready to file. Nothing has been submitted yet. This last question is yours alone to answer, and it cannot be changed afterwards.',
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
      // Three steps hold something that only exists in this tab: the answers
      // on step 1 (in QuestionnaireForm state) and step 2 (handed back but
      // still not filed), and the credentials on step 3 (shown once, never
      // recoverable). The header's tracking link asks before it takes any of
      // them away.
      unsavedWarning={
        step === 1 || step === 2
          ? 'Leaving now discards the answers you have entered - this report has not been submitted yet and nothing is saved. Continue to case tracking?'
          : step === 3
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
            <QuestionnaireForm
              category={category}
              onSubmit={handleQuestionnaireSubmit}
              onCrisisResourcesTrigger={() => setCrisisTriggered(true)}
            />
          </div>

          {/* Appears the moment the in-browser check trips, alongside the form
              the reporter is still filling in - never over it. Nothing about
              this panel blocks, gates, or interrupts the submission; the
              reporter carries on exactly as they were. The anonymous reporting
              flow never learns the company's jurisdictions, so no set is passed
              and every regional route plus the international fallback is
              offered - the reporter may be anywhere. */}
          {crisisTriggered && <CrisisResources />}
        </div>
      )}

      {/* The tier step. It sits between the answers and the filing rather
          than before either, because the trade-off only means something once
          the reporter knows what they have written down - and because a
          reporter who abandons the form here has still handed over nothing. */}
      {step === 2 && (
        <div className="flex flex-col gap-5">
          <Button icon="back" onClick={() => setPending(null)} className="self-start">
            Back to your answers
          </Button>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="sr-only">How you want to be recorded</legend>
            {REPORTER_TIERS.map((option) => {
              const checked = tier === option.value
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                    checked
                      ? 'border-navy bg-navy-50 shadow-[var(--shadow-card)]'
                      : 'border-line bg-surface hover:border-navy-200 hover:bg-navy-50/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="reporter-tier"
                    value={option.value}
                    checked={checked}
                    onChange={() => setTier(option.value)}
                    className="sr-only"
                  />
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      checked ? 'border-navy bg-navy text-white' : 'border-line-soft bg-surface'
                    }`}
                    aria-hidden="true"
                  >
                    {checked && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-charcoal">{option.label}</span>
                    <span className="mt-0.5 block text-sm text-charcoal">{option.summary}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">
                      {option.detail}
                    </span>
                  </span>
                </label>
              )
            })}
          </fieldset>

          {fileError && <Alert variant="error">{fileError}</Alert>}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={!tier}
              loading={filing}
              loadingLabel="Filing your report"
              onClick={() => handleFile(tier)}
            >
              File my report
            </Button>
            <span className="text-xs text-muted">
              Your Case ID and passcode are shown once, on the next screen.
            </span>
          </div>
        </div>
      )}

      {/* This screen is the only time these credentials exist anywhere the
          reporter can see them: the passcode is stored hashed and the case
          has no owner to prove identity against, so nothing here can be
          re-issued or emailed later. It is worth the space it takes. */}
      {step === 3 && (
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

          {/* Optional and non-blocking: the reporter has already completed
              submission by the time they reach this screen, so ignoring this
              changes nothing about their case. Keyed to the Case ID only. */}
          <CaseNotificationOptIn caseId={completed.caseId} passcode={completed.passcode} />

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
                  setPending(null)
                  setTier('')
                  setFileError(null)
                  setCategory(null)
                  setCopied(false)
                  setCopyFailed(false)
                  setCrisisTriggered(false)
                }}
              >
                File another report
              </Button>
            </div>
          </div>

          {/* Shown again here only if the report was filed under a triggering
              condition. The reporter has finished the task they came to do;
              this is a quiet, final offer of support, not a gate on leaving. */}
          {crisisTriggered && <CrisisResources />}
        </div>
      )}
    </ReporterLayout>
  )
}

export default Submit
