import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DEFAULT_FOLLOW_UP_INTERVALS,
  FOLLOW_UP_CATEGORIES,
  JURISDICTIONS,
  PULSE_CADENCES,
  getCompany,
  getStrictestJurisdiction,
  sendPulseChecksNow,
  updateCompanyCrisisContact,
  updateCompanyFollowUpConfig,
  updateCompanyJurisdictions,
  updateCompanyPulseCadence,
} from '../../services/companyService'
import { listEmployees } from '../../services/employeeService'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import StatTile from '../../components/ui/StatTile'
import { Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

const JURISDICTION_LABELS = {
  EU: 'European Union',
  UK: 'United Kingdom',
  US: 'United States',
  LK: 'Sri Lanka',
}

const CATEGORY_LABELS = {
  harassment: 'Harassment',
  toxicManagement: 'Toxic management',
  retaliation: 'Retaliation',
  burnout: 'Burnout',
}

// Parses the admin's comma/space-separated day list into a sorted, de-duplicated
// set of positive whole numbers. Anything non-numeric is dropped rather than
// rejected so a trailing comma or stray space while typing isn't an error.
function parseIntervals(text) {
  return [
    ...new Set(
      String(text)
        .split(/[\s,]+/)
        .map((t) => Number.parseInt(t, 10))
        .filter((n) => Number.isInteger(n) && n > 0)
    ),
  ].sort((a, b) => a - b)
}

// How each cadence reads to a human. The values themselves are the exact
// CADENCE_DAYS keys schedulePulseChecks.js expects (plus the UI-only 'off'),
// so what's stored always round-trips through the scheduler.
const CADENCE_LABELS = {
  off: 'Off - do not send',
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
}

// pulseCheckCadence is stored as one of the CADENCE_DAYS keys or null; null
// (the 'off' state) reads back here as the 'off' option rather than a blank
// select.
function cadenceOf(company) {
  const stored = company?.pulseCheckCadence
  return PULSE_CADENCES.includes(stored) ? stored : 'off'
}

function formatDateTime(value) {
  const ms = value?.toMillis?.() ?? (typeof value === 'number' ? value : null)
  if (!ms) return 'Never sent'
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function sameSet(a, b) {
  return a.length === b.length && a.every((v) => b.includes(v))
}

// Company Settings: the two company-doc fields this panel owns that don't have
// a page of their own - the pulse-check cadence the scheduler reads, and the
// jurisdictions that drive deadline computation. Departments have their own
// page; case content is never read here (the roster count comes from the
// employees subcollection, not from cases).
function SettingsPage({ companyId }) {
  const [company, setCompany] = useState(null)
  // Active roster count only (schedulePulseChecks.js skips inactive employees),
  // so the number shown is who a send would actually reach.
  const [rosterSize, setRosterSize] = useState(0)
  // Of those, how many have no email on file - the ones whose invite parks in
  // awaiting_contact_info until an address is added on the Employees page. This
  // is derived from the roster the client can already read; the notification
  // docs that actually carry that status are Cloud-Functions-only.
  const [awaitingContactCount, setAwaitingContactCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [savingCadence, setSavingCadence] = useState(false)
  // "Send check-in now" - a confirmation gate and an in-flight flag. The send
  // is company-wide and supersedes outstanding links, so it never fires on a
  // single click.
  const [confirmSend, setConfirmSend] = useState(false)
  const [sending, setSending] = useState(false)

  // Jurisdiction edits are staged locally and saved explicitly, so an admin
  // toggling several jurisdictions triggers one write - and one deadline
  // warning - rather than a write per checkbox.
  const [jurisdictions, setJurisdictions] = useState([])
  const [savingJurisdictions, setSavingJurisdictions] = useState(false)

  // Follow-up cadence is staged locally and saved explicitly, same as
  // jurisdictions - the intervals live as a text field the admin edits freely,
  // and disabled categories as a set. Defaults are all four categories on at
  // 30/60/90 days.
  const [intervalsText, setIntervalsText] = useState(DEFAULT_FOLLOW_UP_INTERVALS.join(', '))
  const [disabledCategories, setDisabledCategories] = useState([])
  const [savingFollowUp, setSavingFollowUp] = useState(false)

  // Crisis contact is staged locally and saved explicitly, same pattern as
  // jurisdictions: the three fields the reader (routeCase.js) expects, edited
  // freely and written as one { name, email, phone } record on save.
  const [crisisName, setCrisisName] = useState('')
  const [crisisEmail, setCrisisEmail] = useState('')
  const [crisisPhone, setCrisisPhone] = useState('')
  const [savingCrisisContact, setSavingCrisisContact] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [companyData, employees] = await Promise.all([
        getCompany(companyId),
        listEmployees(companyId),
      ])
      setCompany(companyData)
      setJurisdictions(companyData?.jurisdictions ?? [])
      const followUp = companyData?.followUpConfig
      setIntervalsText(
        (Array.isArray(followUp?.intervalsDays)
          ? followUp.intervalsDays
          : DEFAULT_FOLLOW_UP_INTERVALS
        ).join(', ')
      )
      setDisabledCategories(
        Array.isArray(followUp?.disabledCategories) ? followUp.disabledCategories : []
      )
      const crisisContact = companyData?.crisisContact
      setCrisisName(crisisContact?.name ?? '')
      setCrisisEmail(crisisContact?.email ?? '')
      setCrisisPhone(crisisContact?.phone ?? '')
      const active = employees.filter((e) => e.status !== 'inactive')
      setRosterSize(active.length)
      setAwaitingContactCount(active.filter((e) => !e.email).length)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  async function handleCadenceChange(e) {
    const next = e.target.value
    setSavingCadence(true)
    setError(null)
    setNotice(null)
    try {
      await updateCompanyPulseCadence(companyId, next)
      await refresh()
      setNotice(
        next === 'off'
          ? 'Pulse checks turned off.'
          : `Pulse-check cadence set to ${CADENCE_LABELS[next].toLowerCase()}.`
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingCadence(false)
    }
  }

  async function handleSendNow() {
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      const { queued } = await sendPulseChecksNow()
      setConfirmSend(false)
      await refresh()
      setNotice(
        queued === 0
          ? 'No invites were queued — there is no one active on the roster.'
          : `Queued a pulse check for ${queued} employee${queued === 1 ? '' : 's'}. Delivery goes out shortly.`
      )
    } catch (err) {
      setConfirmSend(false)
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function toggleJurisdiction(code) {
    setJurisdictions((current) =>
      current.includes(code) ? current.filter((j) => j !== code) : [...current, code]
    )
  }

  async function handleSaveJurisdictions() {
    setSavingJurisdictions(true)
    setError(null)
    setNotice(null)
    try {
      await updateCompanyJurisdictions(companyId, jurisdictions)
      await refresh()
      setNotice('Jurisdictions updated. This applies to cases created from now on.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingJurisdictions(false)
    }
  }

  function toggleCategory(code) {
    setDisabledCategories((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
    )
  }

  async function handleSaveFollowUp() {
    const intervals = parseIntervals(intervalsText)
    setSavingFollowUp(true)
    setError(null)
    setNotice(null)
    try {
      await updateCompanyFollowUpConfig(companyId, {
        intervalsDays: intervals,
        disabledCategories,
      })
      await refresh()
      setNotice(
        intervals.length === 0
          ? 'Follow-ups turned off for future closed cases.'
          : 'Follow-up cadence saved. This applies to cases closed from now on.'
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingFollowUp(false)
    }
  }

  async function handleSaveCrisisContact() {
    setSavingCrisisContact(true)
    setError(null)
    setNotice(null)
    try {
      await updateCompanyCrisisContact(companyId, {
        name: crisisName,
        email: crisisEmail,
        phone: crisisPhone,
      })
      await refresh()
      setNotice('Crisis contact saved. Crisis-flagged reports will now notify this person directly.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingCrisisContact(false)
    }
  }

  const cadence = cadenceOf(company)
  const parsedIntervals = parseIntervals(intervalsText)
  const strictestJurisdiction = getStrictestJurisdiction(jurisdictions)
  const savedJurisdictions = company?.jurisdictions ?? []
  const jurisdictionsChanged = !sameSet(jurisdictions, savedJurisdictions)

  const savedCrisisContact = company?.crisisContact ?? {}
  const crisisContactChanged =
    crisisName.trim() !== (savedCrisisContact.name ?? '') ||
    crisisEmail.trim() !== (savedCrisisContact.email ?? '') ||
    crisisPhone.trim() !== (savedCrisisContact.phone ?? '')
  // Mirrors the service's validation so the save button reflects whether a save
  // would succeed - name required, plus at least one contact channel filled in.
  const crisisContactValid =
    crisisName.trim().length > 0 && (crisisEmail.trim().length > 0 || crisisPhone.trim().length > 0)

  if (loading && !company) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <SkeletonList rows={4} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        Company-wide settings: who is notified when a report is flagged as a crisis, how often
        Pulse Checks go out, and which jurisdictions drive compliance deadlines.
      </p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card
        title="Crisis contact"
        description="The one person notified directly when a report is flagged with crisis language. These reports bypass normal case routing entirely and reach this person out of band, so it should be a named individual who can act immediately — not a shared inbox or a distribution list."
        footer={
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={handleSaveCrisisContact}
              loading={savingCrisisContact}
              loadingLabel="Saving"
              disabled={!crisisContactChanged || !crisisContactValid}
            >
              Save crisis contact
            </Button>
            {crisisContactChanged && <span className="text-xs text-muted">Unsaved changes</span>}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {!company?.crisisContact && (
            <Alert variant="warning" title="No crisis contact set">
              Until this is set, reports flagged with crisis language have no one to notify. Add a
              named contact below.
            </Alert>
          )}

          <label className="flex flex-col gap-1.5 text-sm sm:max-w-md">
            <span className="font-medium text-charcoal">Contact name</span>
            <input
              type="text"
              value={crisisName}
              onChange={(e) => setCrisisName(e.target.value)}
              placeholder="e.g. Dr. Jordan Lee, EAP counsellor"
              className="field"
              autoComplete="off"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-charcoal">Email</span>
              <input
                type="email"
                value={crisisEmail}
                onChange={(e) => setCrisisEmail(e.target.value)}
                placeholder="name@example.com"
                className="field"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-charcoal">Phone</span>
              <input
                type="tel"
                value={crisisPhone}
                onChange={(e) => setCrisisPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                className="field"
                autoComplete="off"
              />
            </label>
          </div>

          <p className="text-xs text-muted">
            A name is required, plus at least one way to reach them — an email, a phone number, or
            both. This can be an external provider such as an Employee Assistance Programme; they do
            not need a login on this platform.
          </p>
        </div>
      </Card>

      <Card
        title="Pulse Check cadence"
        description="How often a pulse-check invite is queued for everyone on the roster."
      >
        <div className="flex flex-col gap-4">
          <div className="sm:max-w-xs">
            <Select
              label="Send Pulse Checks"
              value={cadence}
              onChange={handleCadenceChange}
              disabled={savingCadence}
            >
              {PULSE_CADENCES.map((value) => (
                <option key={value} value={value}>
                  {CADENCE_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Active roster"
              value={rosterSize}
              icon="staff"
              tone={rosterSize > 0 ? 'tone-info' : 'tone-neutral'}
              hint="People a send would reach"
            />
            <StatTile
              label="Awaiting contact info"
              value={awaitingContactCount}
              icon="mail"
              tone={awaitingContactCount > 0 ? 'tone-medium' : 'tone-neutral'}
              hint="On the roster but with no email"
            />
            <StatTile
              label="Last sent"
              value={formatDateTime(company?.lastPulseCheckSentAt)}
              icon="clock"
              tone="tone-neutral"
            />
          </div>

          {awaitingContactCount > 0 && (
            <p className="text-xs text-muted">
              {awaitingContactCount} roster member{awaitingContactCount === 1 ? ' has' : 's have'} no
              email on file, so their invite waits until an address is added. Add one on the{' '}
              <Link to="/admin/employees" className="font-medium underline">
                Employees
              </Link>{' '}
              page.
            </p>
          )}

          {rosterSize === 0 && cadence !== 'off' && (
            <Alert variant="warning" title="No one on the roster">
              This cadence will send to nobody until you add employees. Add them on the{' '}
              <Link to="/admin/employees" className="font-medium underline">
                Employees
              </Link>{' '}
              page.
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="secondary"
              icon="pulse"
              onClick={() => setConfirmSend(true)}
              disabled={savingCadence || sending || rosterSize === 0 || cadence === 'off'}
            >
              Send check-in now
            </Button>
            <span className="text-xs text-muted">
              {cadence === 'off'
                ? 'Set a cadence above before sending a check-in on demand.'
                : rosterSize === 0
                  ? 'Add employees before sending a check-in.'
                  : 'Queues a check-in for everyone active right now, outside the schedule.'}
            </span>
          </div>
        </div>
      </Card>

      {confirmSend && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-now-title"
        >
          <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
            <h2 id="send-now-title" className="text-lg font-semibold text-charcoal">
              Send a pulse check now?
            </h2>
            <p className="mt-2 text-sm text-muted">
              This queues a check-in for{' '}
              <strong className="text-charcoal">
                {rosterSize} active employee{rosterSize === 1 ? '' : 's'}
              </strong>{' '}
              right away, regardless of the cadence schedule. Any outstanding pulse-check links are
              superseded — an employee still holding an older link will be sent a fresh one instead.
            </p>
            {awaitingContactCount > 0 && (
              <p className="mt-2 text-xs text-muted">
                {awaitingContactCount} of them ha{awaitingContactCount === 1 ? 's' : 've'} no email on
                file and will wait for an address before delivery.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmSend(false)} disabled={sending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSendNow}
                loading={sending}
                loadingLabel="Sending"
              >
                Send now
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card
        title="Jurisdictions"
        description="The jurisdictions this company operates in. Compliance deadlines follow the strictest one selected."
        footer={
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={handleSaveJurisdictions}
              loading={savingJurisdictions}
              loadingLabel="Saving"
              disabled={!jurisdictionsChanged || jurisdictions.length === 0}
            >
              Save jurisdictions
            </Button>
            {jurisdictionsChanged && (
              <span className="text-xs text-muted">Unsaved changes</span>
            )}
          </div>
        }
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Jurisdictions</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {JURISDICTIONS.map((code) => {
              const checked = jurisdictions.includes(code)
              return (
                <label
                  key={code}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    checked
                      ? 'border-navy bg-navy-50 text-charcoal'
                      : 'border-line bg-surface text-muted hover:border-navy-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleJurisdiction(code)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium text-charcoal">{code}</span>
                  <span className="truncate text-xs">{JURISDICTION_LABELS[code]}</span>
                </label>
              )
            })}
          </div>

          {jurisdictions.length === 0 && (
            <p className="text-xs text-critical">At least one jurisdiction is required.</p>
          )}

          {jurisdictions.length > 1 && strictestJurisdiction && (
            <Alert variant="info" className="mt-1">
              Default compliance timeline follows <strong>{strictestJurisdiction}</strong>, the
              strictest of the selected jurisdictions.
            </Alert>
          )}

          {jurisdictionsChanged && (
            <Alert variant="warning" className="mt-1">
              Changing jurisdictions affects deadline computation for <strong>future cases
              only</strong>. Deadlines are set when a case is created and are not recomputed for
              cases that already exist.
            </Alert>
          )}
        </fieldset>
      </Card>

      <Card
        title="Retaliation follow-up check-ins"
        description="After a case closes, reporters get neutral check-ins asking whether anything has changed. This applies to all categories by default — retaliation can follow any report."
        footer={
          <Button
            variant="primary"
            onClick={handleSaveFollowUp}
            loading={savingFollowUp}
            loadingLabel="Saving"
          >
            Save follow-up settings
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm sm:max-w-md">
            <span className="font-medium text-charcoal">Days after closure to check in</span>
            <input
              type="text"
              value={intervalsText}
              onChange={(e) => setIntervalsText(e.target.value)}
              placeholder="30, 60, 90"
              className="field"
              inputMode="numeric"
            />
            <span className="text-xs text-muted">
              {parsedIntervals.length === 0
                ? 'No check-ins will be sent.'
                : `${parsedIntervals.length} check-in${
                    parsedIntervals.length === 1 ? '' : 's'
                  } at day ${parsedIntervals.join(', ')} after a case closes.`}
            </span>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-charcoal">Categories to follow up</legend>
            <p className="text-xs text-muted">
              All on by default. Untick a category to stop scheduling check-ins for cases closed in
              it.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FOLLOW_UP_CATEGORIES.map((code) => {
                const enabled = !disabledCategories.includes(code)
                return (
                  <label
                    key={code}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      enabled
                        ? 'border-navy bg-navy-50 text-charcoal'
                        : 'border-line bg-surface text-muted hover:border-navy-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleCategory(code)}
                      className="h-4 w-4"
                    />
                    <span className="font-medium text-charcoal">{CATEGORY_LABELS[code]}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <Alert variant="info">
            Check-ins are neutral and optional for the reporter. A reporter can always answer that
            nothing has changed, or ignore them entirely — there is no chasing. Changes here apply
            to cases closed from now on.
          </Alert>
        </div>
      </Card>
    </div>
  )
}

export default SettingsPage
