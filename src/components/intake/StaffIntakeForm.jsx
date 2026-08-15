import { useEffect, useMemo, useState } from 'react'
import CategorySelect from './CategorySelect'
import QuestionnaireForm from './QuestionnaireForm'
import CaseCredentialsHandoff from './CaseCredentialsHandoff'
import CrisisResources from '../shared/CrisisResources'
import { CATEGORIES } from '../../data/categories'
import { getCompany } from '../../services/companyService'
import {
  BACKDATE_WARNING_DAYS,
  INTAKE_METHODS,
  TIERS,
  createCaseOnBehalf,
} from '../../services/staffIntakeService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Icon from '../ui/Icon'
import { Input, Textarea } from '../ui/Field'

const DAY_MS = 24 * 60 * 60 * 1000

// `datetime-local` wants local wall-clock text, not an ISO instant, so the
// timezone offset is subtracted before slicing. Getting this wrong would
// silently shift every recorded arrival time by the offset - which for a
// backdated report is a shift in a compliance deadline.
function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

const STEPS = ['How it arrived', 'What happened', 'Reporter’s choice']

// Staff-facing intake: a Case Handler or HR Coordinator typing up a report
// that reached the company by phone, by email, or across a desk.
//
// The questionnaire is not re-authored for staff. It is the same
// CategorySelect and QuestionnaireForm the reporter's own flow uses, reading
// the same definitions in src/data/questionnaires - so a phoned-in
// harassment report is scored against exactly the questions a web-filed one
// was, and there is no second copy of the wording to drift. What is added
// around it is only what a second-hand report needs and a first-hand one
// doesn't: how it arrived, when it arrived, and confirmation that the tier
// on the case is the reporter's own answer rather than the intake taker's
// assumption.
function StaffIntakeForm({ companyId }) {
  const [step, setStep] = useState(0)

  // The subject_department select needs the company's own department list
  // (same source RoutingRulesPage reads) - fetched once here rather than
  // baked into the questionnaire definition, so a phoned-in report offers the
  // same departments as the reporter's own /submit/:companySlug form.
  const [departments, setDepartments] = useState([])
  useEffect(() => {
    if (!companyId) return
    let active = true
    getCompany(companyId).then((company) => {
      if (active) setDepartments(company?.departments ?? [])
    })
    return () => {
      active = false
    }
  }, [companyId])

  // Step 0 - the context that only exists because someone else took this
  // report down.
  const [intakeMethod, setIntakeMethod] = useState('')
  const [reportedAtInput, setReportedAtInput] = useState(() => toLocalInputValue(new Date()))
  const [category, setCategory] = useState(null)

  // Step 1 - the questionnaire, captured but not yet filed.
  const [responses, setResponses] = useState(null)
  // Sticky for the rest of this session once the in-browser check trips, same
  // as Submit.jsx's reporter flow - never written to the case, sent to a
  // server, or logged. See crisisTextCheck.js and CrisisResources.jsx for the
  // constraints this exists under.
  const [crisisTriggered, setCrisisTriggered] = useState(false)

  // Step 2 - the reporter's tier decision and, for confidential, who they are.
  const [tier, setTier] = useState('')
  const [identity, setIdentity] = useState({ name: '', email: '', phone: '', jobTitle: '', notes: '' })
  const [informedConfirmed, setInformedConfirmed] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [filed, setFiled] = useState(null)

  const reportedAtMs = useMemo(() => {
    const parsed = new Date(reportedAtInput).getTime()
    return Number.isFinite(parsed) ? parsed : null
  }, [reportedAtInput])

  // "Now" is state that ticks, the same approach HRCoordinatorDashboard uses
  // for its deadline counters, rather than a Date.now() read during render.
  // A form can sit open on an HR desk through a long conversation, and both
  // the future-date check and the how-far-backdated warning should reflect
  // when the staff member actually files - not when the page loaded.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  // A minute of tolerance for clock skew between this browser and the
  // server, matching parseReportedAt() in createCaseOnBehalf.js so the form
  // never accepts a value the callable will reject.
  const isFuture = reportedAtMs !== null && reportedAtMs > now + 60_000
  const backdatedDays = reportedAtMs === null ? 0 : Math.floor((now - reportedAtMs) / DAY_MS)
  // Warned about, never blocked - the server takes an old report too. Staff
  // pushed to make a date "acceptable" would just enter a wrong one, and a
  // wrong arrival date is worse than a flagged true one.
  const isVeryOld = backdatedDays > BACKDATE_WARNING_DAYS

  const categoryLabel = CATEGORIES.find((c) => c.id === category)?.label
  const methodLabel = INTAKE_METHODS.find((m) => m.value === intakeMethod)?.label

  const identityGiven = ['name', 'email', 'phone', 'jobTitle', 'notes'].some(
    (field) => identity[field].trim().length > 0
  )

  function updateIdentity(field, value) {
    setIdentity((current) => ({ ...current, [field]: value }))
  }

  function resetAll() {
    setStep(0)
    setIntakeMethod('')
    setReportedAtInput(toLocalInputValue(new Date()))
    setCategory(null)
    setResponses(null)
    setCrisisTriggered(false)
    setTier('')
    setIdentity({ name: '', email: '', phone: '', jobTitle: '', notes: '' })
    setInformedConfirmed(false)
    setError(null)
    setFiled(null)
  }

  // QuestionnaireForm awaits its onSubmit and keeps the answers on screen if
  // it throws, so nothing is filed here - the answers are held until the
  // reporter's tier choice has been recorded on the next step.
  async function handleQuestionnaireSubmit(submission) {
    setResponses(submission.responses)
    setStep(2)
  }

  async function handleFile() {
    setError(null)

    if (!informedConfirmed) {
      setError('Confirm that you explained both options to the reporter before filing.')
      return
    }
    if (tier === 'confidential' && !identityGiven) {
      setError(
        'Add at least one contact detail for the reporter, or file the case as anonymous instead.'
      )
      return
    }

    setSubmitting(true)
    try {
      const result = await createCaseOnBehalf({
        category,
        responses,
        tier,
        intakeMethod,
        reportedAt: reportedAtMs,
        reporterInformedOfTier: true,
        reporterIdentity: identity,
      })
      // Everything typed into the identity fields is dropped from component
      // state the moment the server has it. It is in the vault now; keeping a
      // second copy alive in a React tree that may sit open on an HR desk all
      // afternoon serves nothing.
      setIdentity({ name: '', email: '', phone: '', jobTitle: '', notes: '' })
      setFiled(result)
      setStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 3 && filed) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <CaseCredentialsHandoff
          caseId={filed.caseId}
          passcode={filed.passcode}
          tier={filed.tier}
          backdateWarning={filed.backdateWarning}
          onDone={resetAll}
          onFileAnother={resetAll}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      {/* Same three-beat progression the reporter's flow shows, so a staff
          member who has walked someone through the public form recognises
          where they are. */}
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <Badge tone={index === step ? 'tone-info' : index < step ? 'tone-low' : 'tone-neutral'}>
              {index < step && <Icon name="check" className="h-3 w-3" />}
              {label}
            </Badge>
            {index < STEPS.length - 1 && (
              <Icon name="chevronRight" className="h-3 w-3 text-subtle" aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <Alert variant="info" title="You are filing on someone else's behalf">
            This creates a real case with a real Case ID and passcode, which you hand to the
            reporter afterwards. It is scored, routed, and given compliance deadlines exactly
            like a report filed through the public form - the only difference recorded is that
            you typed it in.
          </Alert>

          <Card
            title="How the report reached you"
            description="Recorded on the case so the investigation knows it is a second-hand account."
          >
            <fieldset className="flex flex-col gap-2.5">
              <legend className="sr-only">Intake method</legend>
              {INTAKE_METHODS.map((method) => {
                const checked = intakeMethod === method.value
                return (
                  <label
                    key={method.value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all ${
                      checked
                        ? 'border-navy bg-navy-50 shadow-[var(--shadow-card)]'
                        : 'border-line bg-surface hover:border-navy-200 hover:bg-navy-50/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="intake-method"
                      value={method.value}
                      checked={checked}
                      onChange={() => setIntakeMethod(method.value)}
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
                      <span className="block font-medium text-charcoal">{method.label}</span>
                      <span className="mt-0.5 block text-sm text-muted">{method.description}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>

            {intakeMethod === 'phone' && (
              <p className="mt-3 text-xs text-muted">
                Type up what you were told. Rectifia does not record or transcribe calls - what
                you write here is the record.
              </p>
            )}
          </Card>

          <Card
            title="When the report reached the company"
            description="Not when you are entering it. The compliance clock starts from this date."
          >
            <Input
              type="datetime-local"
              label="Date and time received"
              required
              value={reportedAtInput}
              max={toLocalInputValue(new Date(now))}
              onChange={(e) => setReportedAtInput(e.target.value)}
              error={isFuture ? 'This is in the future - a report cannot arrive before now.' : null}
              hint={
                isFuture
                  ? null
                  : 'If the reporter first raised this weeks ago, enter that date. Acknowledgment and feedback deadlines are calculated from it, so entering today would restart a clock that has already been running.'
              }
            />

            {isVeryOld && !isFuture && (
              <Alert variant="warning" className="mt-3" title={`Received ${backdatedDays} days ago`}>
                That is well outside the usual window. The case will still be filed - this is a
                warning, not a block - but its deadlines will be calculated from that date and
                may already have passed. Check the date is right before continuing.
              </Alert>
            )}
          </Card>

          <Card
            title="What the report is about"
            description="Choose the category that fits what the reporter described. It decides which questions follow."
          >
            {!intakeMethod || isFuture || reportedAtMs === null ? (
              <p className="text-sm text-muted">
                Choose how the report arrived and give a valid date received first.
              </p>
            ) : (
              <CategorySelect
                onSelect={(selected) => {
                  setCategory(selected)
                  setStep(1)
                }}
              />
            )}
          </Card>
        </>
      )}

      {step === 1 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              icon="back"
              onClick={() => {
                setCategory(null)
                setStep(0)
              }}
            >
              Change how it arrived
            </Button>
            <span className="text-xs text-muted">
              {categoryLabel} · {methodLabel}
            </span>
          </div>

          <Alert variant="info">
            Answer as the reporter described it, in their words where you can. Where they
            didn&apos;t say, choose the option that is true rather than the one that sounds
            worst - these answers are scored, and a guess is scored as though it were told to
            you.
          </Alert>

          <Card>
            {/* The reporter's own questionnaire, unmodified. Nothing is filed
                when this submits - it hands the answers back and moves to the
                tier step, because the tier has to be on the document at
                creation, not added afterwards. */}
            <QuestionnaireForm
              category={category}
              departments={departments}
              onSubmit={handleQuestionnaireSubmit}
              onCrisisResourcesTrigger={() => setCrisisTriggered(true)}
              // Addressed to the intake taker, not the reporter: these are
              // resources they can read out to the person on the call, not
              // support offered to themselves.
              crisisSlot={
                crisisTriggered && (
                  <CrisisResources
                    heading="Support resources for the reporter"
                    intro="If what they described suggests they may be in crisis, you can offer them one of these to reach out to directly - separately from this report."
                  />
                )
              }
            />
          </Card>
        </>
      )}

      {step === 2 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button icon="back" onClick={() => setStep(1)}>
              Back to the answers
            </Button>
            <span className="text-xs text-muted">
              {responses?.length ?? 0} answer{responses?.length === 1 ? '' : 's'} recorded
            </span>
          </div>

          <Card
            title="How does the reporter want to be recorded?"
            description="This is their decision, not yours. Read both options to them and record the one they chose."
          >
            <fieldset className="flex flex-col gap-2.5">
              <legend className="sr-only">Reporting tier</legend>
              {TIERS.map((option) => {
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

            {tier === 'anonymous' && (
              <Alert variant="info" className="mt-3" title="Nothing identifying will be stored">
                Don&apos;t put the reporter&apos;s name into the answers on the previous step
                either - anonymous means the case document holds no way back to them, and a name
                typed into a free-text answer defeats that as completely as a name field would.
              </Alert>
            )}
          </Card>

          {tier === 'confidential' && (
            <Card
              title="Reporter's details"
              description="Encrypted before storage. Not shown on any dashboard, in any case report, or to anyone but the assigned investigator."
            >
              <div className="flex flex-col gap-4">
                <Input
                  label="Name"
                  value={identity.name}
                  onChange={(e) => updateIdentity('name', e.target.value)}
                  autoComplete="off"
                />
                <Input
                  label="Email"
                  type="email"
                  value={identity.email}
                  onChange={(e) => updateIdentity('email', e.target.value)}
                  autoComplete="off"
                />
                <Input
                  label="Phone"
                  value={identity.phone}
                  onChange={(e) => updateIdentity('phone', e.target.value)}
                  autoComplete="off"
                />
                <Input
                  label="Job title or team"
                  hint="Optional. Helps the investigator understand the reporter's position relative to what they described."
                  value={identity.jobTitle}
                  onChange={(e) => updateIdentity('jobTitle', e.target.value)}
                  autoComplete="off"
                />
                <Textarea
                  label="How and when to contact them"
                  hint="Optional. Anything about reaching them safely - a preferred number, times to avoid, not to call their work line."
                  rows={3}
                  value={identity.notes}
                  onChange={(e) => updateIdentity('notes', e.target.value)}
                />
              </div>

              <Alert variant="warning" className="mt-4" title="Once stored, this is not casually readable">
                These details are encrypted with a key this application cannot use. Reading them
                back requires a Super Admin and a documented legal reason, and every attempt is
                recorded - including yours, if you make one. Enter what an investigator needs to
                reach the reporter, and nothing more.
              </Alert>
            </Card>
          )}

          {/* The confirmation is the point of this whole step. Recording a
              tier the reporter was never offered turns their choice into the
              intake taker's assumption, permanently, on a compliance record -
              so the confirmation is stored on the case alongside the tier and
              the server refuses to file without it. */}
          <Card title="Confirm you gave the reporter the choice">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface p-3.5 text-sm">
              <input
                type="checkbox"
                checked={informedConfirmed}
                onChange={(e) => setInformedConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="text-charcoal">
                I explained both options to the reporter - including that anonymous means nobody
                can ever identify them and that it can make some investigations harder to
                complete - and the tier above is the one they chose.
              </span>
            </label>
            <p className="mt-2 text-xs text-muted">
              This confirmation is stored on the case and in the intake audit log.
            </p>
          </Card>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={handleFile}
              disabled={!tier || !informedConfirmed}
              loading={submitting}
              loadingLabel="Filing case"
            >
              File this case
            </Button>
            <span className="text-xs text-muted">
              The Case ID and passcode are shown once, on the next screen.
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export default StaffIntakeForm
