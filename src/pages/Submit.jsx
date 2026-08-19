import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReporterLayout from '../components/shared/ReporterLayout'
import CategorySelect from '../components/intake/CategorySelect'
import DataHandlingNotice from '../components/intake/DataHandlingNotice'
import QuestionnaireForm from '../components/intake/QuestionnaireForm'
import CrisisResources from '../components/shared/CrisisResources'
import CaseNotificationOptIn from '../components/intake/CaseNotificationOptIn'
import { uploadStagedEvidence, StagedEvidenceStatus } from '../components/intake/CaseCredentialsHandoff'
import { CATEGORIES } from '../data/categories'
import { resolveCompanySlug, submitCase } from '../services/caseAccessService'
import { downloadSimplePdf, RECTIFIA_BRAND_COLOR } from '../utils/simplePdf'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import Icon from '../components/ui/Icon'

// The tier values stay stable identifiers; label/summary/detail are resolved
// from translations at render time (see REPORTER_TIER_VALUES usage below),
// since the same copy is shown to staff taking a report by phone (see TIERS
// in src/services/staffIntakeService.js) and needs to be the same question
// regardless of language.
const REPORTER_TIER_VALUES = ['anonymous', 'confidential']

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
  const { t } = useTranslation()
  const STEPS = [t('submit.steps.category'), t('submit.steps.details'), t('submit.steps.yourChoice'), t('submit.steps.submit')]
  const { companySlug } = useParams()
  const [category, setCategory] = useState(null)
  // Null until the reporter ticks the data-handling notice at category
  // selection; once set, { acknowledged: true, acknowledgedAt, policyVersion }
  // - see DataHandlingNotice.jsx. This exact shape is what gates advancing
  // past step 0 (via CategorySelect's canContinue) and is sent to
  // submitCase verbatim, so the record on the case document is the same
  // object the reporter actually acknowledged, not a re-derived one.
  const [acknowledgment, setAcknowledgment] = useState(null)
  // The completed questionnaire, held in this tab only, between the answers
  // being finished and the tier being chosen. Nothing is filed until both.
  const [pending, setPending] = useState(null)
  const [tier, setTier] = useState('')
  const [filing, setFiling] = useState(false)
  const [fileError, setFileError] = useState(null)
  const [completed, setCompleted] = useState(null)
  // The staged evidence's upload outcome, kicked off only after `completed`
  // is already set - see handleFile below. Both start empty/false and never
  // gate anything on this screen; they exist purely to report what happened.
  const [evidenceUploading, setEvidenceUploading] = useState(false)
  const [evidenceResults, setEvidenceResults] = useState([])
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
      // `files` never goes near submitCase - it's browser File objects, not
      // serialisable case data, and the case document must not carry
      // filenames or attachment metadata (that belongs on a message). It is
      // pulled off pending here and used only after the case exists.
      const { files, ...caseSubmission } = pending
      const { caseId, passcode } = await submitCase({
        ...caseSubmission,
        companySlug,
        tier: chosenTier,
        // Guaranteed non-null here: step 0's Continue button is gated on it
        // (see CategorySelect's canContinue), so there is no path from
        // category selection to this step without it.
        dataHandlingAcknowledgment: acknowledgment,
      })
      // The credentials are committed to state before anything about
      // evidence runs - see the module-level constraint this screen exists
      // to honour: an upload failure must never cost the reporter their
      // Case ID and passcode, which this screen shows exactly once.
      setCompleted({ caseId, passcode, responseCount: pending.responses.length })
      if (files?.length > 0) {
        setEvidenceUploading(true)
        uploadStagedEvidence(caseId, passcode, files).then((results) => {
          setEvidenceResults(results)
          setEvidenceUploading(false)
        })
      }
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
      <ReporterLayout title={t('submit.loading.title')} description={t('submit.loading.description')}>
        <div className="card p-6 text-sm text-muted">{t('submit.loading.oneMoment')}</div>
      </ReporterLayout>
    )
  }

  // Either the lookup failed to run, or it ran and the slug belongs to no
  // company. Both mean the reporter can't file here - show a clear message,
  // never a blank form that would silently discard their report.
  if (resolveError || !company?.found) {
    return (
      <ReporterLayout
        title={t('submit.invalidLink.title')}
        description={t('submit.invalidLink.description')}
      >
        <Alert variant="error" title={t('submit.invalidLink.alertTitle')}>
          {t('submit.invalidLink.alertBody')}
          {resolveError && (
            <p className="mt-2 text-xs">{t('submit.invalidLink.tempUnavailable')}</p>
          )}
        </Alert>
        <div className="mt-4">
          <Link to="/case" className="btn btn-secondary">
            {t('reporterLayout.trackExisting')}
          </Link>
        </div>
      </ReporterLayout>
    )
  }

  // A real, existing company - but suspended (Super Admin action, non-payment
  // or offboarding). Shown up front rather than only failing at the final
  // submitCase call, so a reporter never spends time on a questionnaire that
  // was never going to file. submitCase.js re-checks this server-side
  // regardless, since suspension can change between this lookup and filing.
  if (company.suspended) {
    return (
      <ReporterLayout
        title={t('submit.suspended.title')}
        description={t('submit.suspended.description')}
      >
        <Alert variant="error" title={t('submit.suspended.alertTitle')}>
          {t('submit.suspended.alertBody')}
        </Alert>
        <div className="mt-4">
          <Link to="/case" className="btn btn-secondary">
            {t('reporterLayout.trackExisting')}
          </Link>
        </div>
      </ReporterLayout>
    )
  }

  const step = completed ? 3 : pending ? 2 : category ? 1 : 0
  const categoryLabel = CATEGORIES.some((c) => c.id === category)
    ? t(`categories.${category}.label`)
    : undefined

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

  // Same three values as the screen itself, saved somewhere a reporter can
  // find again after closing the tab. Same privacy constraint as
  // CaseCredentialsHandoff's downloadDetails(): no company name, no report
  // category, and a filename that doesn't announce what the file is to
  // anything indexing a Downloads folder.
  async function downloadCredentialsPdf() {
    if (!completed) return
    await downloadSimplePdf(
      [
        // Rectifia's own wordmark, not the reporting company's - same
        // privacy constraint as the rest of this document, see the comment
        // above this function.
        { text: 'RECTIFIA', bold: true, color: RECTIFIA_BRAND_COLOR },
        { rule: true, color: RECTIFIA_BRAND_COLOR },
        '',
        { text: t('submit.pdf.heading'), bold: true },
        '',
        t('submit.filed.caseId') + `: ${completed.caseId}`,
        t('submit.filed.passcode') + `: ${completed.passcode}`,
        trackingUrl ? t('submit.pdf.trackLine', { url: trackingUrl }) : null,
        '',
        t('submit.pdf.keepPrivate1'),
        t('submit.pdf.keepPrivate2'),
      ].filter((line) => line !== null),
      'personal-notes.pdf'
    )
  }

  const COPY = [
    {
      title: t('submit.steps0.titleGeneric'),
      description: company.companyName
        ? t('submit.steps0.descriptionWithCompany', { company: company.companyName })
        : t('submit.steps0.descriptionNoCompany'),
    },
    {
      title: t('submit.steps1.title'),
      description: t('submit.steps1.description', {
        category: categoryLabel ?? t('submit.steps1.defaultCategory'),
      }),
    },
    {
      title: t('submit.steps2.title'),
      description: t('submit.steps2.description'),
    },
    {
      title: t('submit.steps3.title'),
      description: t('submit.steps3.description'),
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
          ? t('submit.unsavedWarning.answers')
          : step === 3
            ? t('submit.unsavedWarning.credentials')
            : undefined
      }
      footerNote={t('submit.footerNote')}
    >
      {step === 0 && (
        <CategorySelect onSelect={setCategory} canContinue={Boolean(acknowledgment)}>
          <DataHandlingNotice acknowledgment={acknowledgment} onChange={setAcknowledgment} />
        </CategorySelect>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-5">
          <Button icon="back" onClick={() => setCategory(null)} className="self-start">
            {t('submit.steps1.changeCategory')}
          </Button>
          <div className="card p-6">
            <QuestionnaireForm
              category={category}
              departments={company.departments ?? []}
              onSubmit={handleQuestionnaireSubmit}
              onCrisisResourcesTrigger={() => setCrisisTriggered(true)}
              allowEvidenceStaging
              // Appears directly under the field that tripped the in-browser
              // check, inside the same card, above the evidence step and the
              // Continue button - never below the form as a whole, where it
              // reads as page footer and gets skipped. Nothing about this
              // panel blocks, gates, or interrupts the submission; the
              // reporter carries on exactly as they were. The anonymous
              // reporting flow never learns the company's jurisdictions, so
              // no set is passed - resolveResources falls back to a
              // timezone-derived best guess plus every other region tucked
              // in the collapsed "other countries" expander.
              crisisSlot={crisisTriggered && <CrisisResources />}
            />
          </div>
        </div>
      )}

      {/* The tier step. It sits between the answers and the filing rather
          than before either, because the trade-off only means something once
          the reporter knows what they have written down - and because a
          reporter who abandons the form here has still handed over nothing. */}
      {step === 2 && (
        <div className="flex flex-col gap-5">
          <Button icon="back" onClick={() => setPending(null)} className="self-start">
            {t('submit.steps2.backToAnswers')}
          </Button>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="sr-only">{t('submit.steps2.title')}</legend>
            {REPORTER_TIER_VALUES.map((value) => {
              const checked = tier === value
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                    checked
                      ? 'border-navy bg-navy-50 shadow-[var(--shadow-card)]'
                      : 'border-line bg-surface hover:border-navy-200 hover:bg-navy-50/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="reporter-tier"
                    value={value}
                    checked={checked}
                    onChange={() => setTier(value)}
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
                    <span className="block font-medium text-charcoal">
                      {t(`submit.tiers.${value}.label`)}
                    </span>
                    <span className="mt-0.5 block text-sm text-charcoal">
                      {t(`submit.tiers.${value}.summary`)}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted">
                      {t(`submit.tiers.${value}.detail`)}
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
              loadingLabel={t('submit.steps2.filingYourReport')}
              onClick={() => handleFile(tier)}
            >
              {t('submit.steps2.fileReport')}
            </Button>
            <span className="text-xs text-muted">{t('submit.steps2.credentialsShownOnce')}</span>
          </div>
        </div>
      )}

      {/* This screen is the only time these credentials exist anywhere the
          reporter can see them: the passcode is stored hashed and the case
          has no owner to prove identity against, so nothing here can be
          re-issued or emailed later. It is worth the space it takes. */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <Alert variant="success" title={t('submit.filed.alertTitle')}>
            {t('submit.filed.summary', { count: completed.responseCount, category: categoryLabel })}
          </Alert>

          <div className="card p-6">
            <dl className="flex flex-col gap-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">{t('submit.filed.caseId')}</dt>
                <dd className="mt-1 select-all font-mono text-lg font-semibold text-charcoal">
                  {completed.caseId}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">{t('submit.filed.passcode')}</dt>
                <dd className="mt-1 select-all font-mono text-lg font-semibold text-charcoal">
                  {completed.passcode}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  {t('submit.filed.whereToCheck')}
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
                      {copied ? t('submit.filed.copied') : t('submit.filed.copyLink')}
                    </Button>
                    <Button icon="document" onClick={downloadCredentialsPdf}>
                      {t('submit.filed.downloadPdf')}
                    </Button>
                    {copyFailed && (
                      <span className="text-xs text-muted">{t('submit.filed.copyFailedNote')}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted">{t('submit.filed.linkExplanation')}</p>
                </dd>
              </div>
            </dl>
          </div>

          <Alert variant="warning" title={t('submit.filed.passcodeWarningTitle')}>
            {t('submit.filed.passcodeWarningBody1')}{' '}
            <strong className="font-semibold">{t('submit.filed.passcodeWarningStrong')}</strong>{' '}
            {t('submit.filed.passcodeWarningBody2')}
          </Alert>

          <StagedEvidenceStatus uploading={evidenceUploading} results={evidenceResults} />

          {/* Optional and non-blocking: the reporter has already completed
              submission by the time they reach this screen, so ignoring this
              changes nothing about their case. Keyed to the Case ID only. */}
          <CaseNotificationOptIn caseId={completed.caseId} passcode={completed.passcode} />

          <div className="card p-6">
            <h2 className="text-sm font-semibold text-charcoal">{t('submit.filed.beforeYouLeave.title')}</h2>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-muted">
              <li>{t('submit.filed.beforeYouLeave.bookmark')}</li>
              <li>{t('submit.filed.beforeYouLeave.writePasscode')}</li>
              <li>{t('submit.filed.beforeYouLeave.comeBack')}</li>
            </ul>
            <div className="mt-4">
              <Button
                onClick={() => {
                  setCompleted(null)
                  setPending(null)
                  setTier('')
                  setFileError(null)
                  setCategory(null)
                  setAcknowledgment(null)
                  setCopied(false)
                  setCopyFailed(false)
                  setCrisisTriggered(false)
                  setEvidenceUploading(false)
                  setEvidenceResults([])
                }}
              >
                {t('submit.filed.fileAnother')}
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
