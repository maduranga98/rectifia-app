import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import i18n from '../../services/i18n'
import {
  DEFAULT_FOLLOW_UP_INTERVALS,
  FOLLOW_UP_CATEGORIES,
  SELECTABLE_JURISDICTIONS,
  PULSE_CADENCES,
  getCompany,
  getStrictestJurisdiction,
  isValidTimeZone,
  sendPulseChecksNow,
  updateCompanyCrisisContact,
  updateCompanyFollowUpConfig,
  updateCompanyJurisdictions,
  updateCompanyPulseCadence,
  updateCompanyTimeZone,
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
  AU: 'Australia',
  JP: 'Japan',
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

// pulseCheckCadence is stored as one of the CADENCE_DAYS keys or null; null
// (the 'off' state) reads back here as the 'off' option rather than a blank
// select.
function cadenceOf(company) {
  const stored = company?.pulseCheckCadence
  return PULSE_CADENCES.includes(stored) ? stored : 'off'
}

function formatDateTime(value) {
  const ms = value?.toMillis?.() ?? (typeof value === 'number' ? value : null)
  if (!ms) return i18n.t('settingsPage.neverSent')
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function sameSet(a, b) {
  return a.length === b.length && a.every((v) => b.includes(v))
}

// Live confirmation string so an admin typing a zone can tell at a glance
// whether they picked the right one, e.g. "Currently 4:32 PM in
// Asia/Tokyo" - resolved the same way
// functions/src/utils/companySchedule.js resolves the local hour that
// actually gates the two per-company sweeps, just formatted for a human
// instead of reduced to an hour number.
function currentLocalTimeLabel(timeZone) {
  if (!isValidTimeZone(timeZone)) return null
  try {
    const time = new Date().toLocaleTimeString(undefined, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    })
    return i18n.t('settingsPage.currentlyInTimeZone', { time, timeZone })
  } catch {
    return null
  }
}

// Company Settings: the two company-doc fields this panel owns that don't have
// a page of their own - the pulse-check cadence the scheduler reads, and the
// jurisdictions that drive deadline computation. Departments have their own
// page; case content is never read here (the roster count comes from the
// employees subcollection, not from cases).
function SettingsPage({ companyId }) {
  const { t } = useTranslation()
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

  // Time zone is staged and saved independently of jurisdictions - changing
  // jurisdictions must never silently overwrite an admin's explicit time
  // zone choice, so this has its own save button rather than riding along
  // with handleSaveJurisdictions.
  const [timeZoneInput, setTimeZoneInput] = useState('')
  const [savingTimeZone, setSavingTimeZone] = useState(false)

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
      setTimeZoneInput(companyData?.timeZone ?? '')
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
          ? t('settingsPage.notices.pulseOff')
          : t('settingsPage.notices.cadenceSet', { cadence: t(`settingsPage.cadenceLabels.${next}`) })
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
          ? t('settingsPage.notices.noInvitesQueued')
          : t('settingsPage.notices.queuedFor', { count: queued })
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
      setNotice(t('settingsPage.notices.jurisdictionsUpdated'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingJurisdictions(false)
    }
  }

  async function handleSaveTimeZone() {
    setSavingTimeZone(true)
    setError(null)
    setNotice(null)
    try {
      await updateCompanyTimeZone(companyId, timeZoneInput.trim())
      await refresh()
      setNotice(t('settingsPage.notices.timeZoneSet', { timeZone: timeZoneInput.trim() }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingTimeZone(false)
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
          ? t('settingsPage.notices.followUpOff')
          : t('settingsPage.notices.followUpSaved')
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
      setNotice(t('settingsPage.notices.crisisContactSaved'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingCrisisContact(false)
    }
  }

  const cadence = cadenceOf(company)
  const parsedIntervals = parseIntervals(intervalsText)
  const strictestJurisdiction = getStrictestJurisdiction(jurisdictions)
  const deprecatedJurisdictions = jurisdictions.filter(
    (code) => !SELECTABLE_JURISDICTIONS.includes(code)
  )
  const savedJurisdictions = company?.jurisdictions ?? []
  const jurisdictionsChanged = !sameSet(jurisdictions, savedJurisdictions)

  const timeZoneTrimmed = timeZoneInput.trim()
  const timeZoneValid = timeZoneTrimmed.length === 0 || isValidTimeZone(timeZoneTrimmed)
  const timeZoneChanged = timeZoneTrimmed !== (company?.timeZone ?? '')
  const timeZoneLocalLabel = currentLocalTimeLabel(timeZoneTrimmed)

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
      <p className="max-w-2xl text-sm text-muted">{t('settingsPage.intro')}</p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card
        title={t('settingsPage.crisisContact.title')}
        description={t('settingsPage.crisisContact.description')}
        footer={
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={handleSaveCrisisContact}
              loading={savingCrisisContact}
              loadingLabel={t('settingsPage.saving')}
              disabled={!crisisContactChanged || !crisisContactValid}
            >
              {t('settingsPage.crisisContact.saveButton')}
            </Button>
            {crisisContactChanged && <span className="text-xs text-muted">{t('settingsPage.unsavedChanges')}</span>}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {!company?.crisisContact && (
            <Alert variant="warning" title={t('settingsPage.crisisContact.noneSet.title')}>
              {t('settingsPage.crisisContact.noneSet.body')}
            </Alert>
          )}

          <label className="flex flex-col gap-1.5 text-sm sm:max-w-md">
            <span className="font-medium text-charcoal">{t('settingsPage.crisisContact.nameLabel')}</span>
            <input
              type="text"
              value={crisisName}
              onChange={(e) => setCrisisName(e.target.value)}
              placeholder={t('settingsPage.crisisContact.namePlaceholder')}
              className="field"
              autoComplete="off"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-charcoal">{t('settingsPage.crisisContact.emailLabel')}</span>
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
              <span className="font-medium text-charcoal">{t('settingsPage.crisisContact.phoneLabel')}</span>
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

          <p className="text-xs text-muted">{t('settingsPage.crisisContact.hint')}</p>
        </div>
      </Card>

      <Card
        title={t('settingsPage.pulseCadence.title')}
        description={t('settingsPage.pulseCadence.description')}
      >
        <div className="flex flex-col gap-4">
          <div className="sm:max-w-xs">
            <Select
              label={t('settingsPage.pulseCadence.selectLabel')}
              value={cadence}
              onChange={handleCadenceChange}
              disabled={savingCadence}
            >
              {PULSE_CADENCES.map((value) => (
                <option key={value} value={value}>
                  {t(`settingsPage.cadenceLabels.${value}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label={t('settingsPage.pulseCadence.activeRoster')}
              value={rosterSize}
              icon="staff"
              tone={rosterSize > 0 ? 'tone-info' : 'tone-neutral'}
              hint={t('settingsPage.pulseCadence.activeRosterHint')}
            />
            <StatTile
              label={t('settingsPage.pulseCadence.awaitingContact')}
              value={awaitingContactCount}
              icon="mail"
              tone={awaitingContactCount > 0 ? 'tone-medium' : 'tone-neutral'}
              hint={t('settingsPage.pulseCadence.awaitingContactHint')}
            />
            <StatTile
              label={t('settingsPage.pulseCadence.lastSent')}
              value={formatDateTime(company?.lastPulseCheckSentAt)}
              icon="clock"
              tone="tone-neutral"
            />
          </div>

          {awaitingContactCount > 0 && (
            <p className="text-xs text-muted">
              <Trans
                i18nKey="settingsPage.pulseCadence.awaitingContactNotice"
                count={awaitingContactCount}
                components={{
                  link: <Link to="/admin/employees" className="font-medium underline" />,
                }}
              />
            </p>
          )}

          {rosterSize === 0 && cadence !== 'off' && (
            <Alert variant="warning" title={t('settingsPage.pulseCadence.noRoster.title')}>
              <Trans
                i18nKey="settingsPage.pulseCadence.noRoster.body"
                components={{
                  link: <Link to="/admin/employees" className="font-medium underline" />,
                }}
              />
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="secondary"
              icon="pulse"
              onClick={() => setConfirmSend(true)}
              disabled={savingCadence || sending || rosterSize === 0 || cadence === 'off'}
            >
              {t('settingsPage.pulseCadence.sendNowButton')}
            </Button>
            <span className="text-xs text-muted">
              {cadence === 'off'
                ? t('settingsPage.pulseCadence.setCadenceHint')
                : rosterSize === 0
                  ? t('settingsPage.pulseCadence.addEmployeesHint')
                  : t('settingsPage.pulseCadence.sendNowHint')}
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
              {t('settingsPage.sendNowModal.title')}
            </h2>
            <p className="mt-2 text-sm text-muted">
              <Trans
                i18nKey="settingsPage.sendNowModal.body"
                count={rosterSize}
                values={{ count: rosterSize }}
                components={{ strong: <strong className="text-charcoal" /> }}
              />
            </p>
            {awaitingContactCount > 0 && (
              <p className="mt-2 text-xs text-muted">
                {t('settingsPage.sendNowModal.awaitingContactNotice', { count: awaitingContactCount })}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmSend(false)} disabled={sending}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleSendNow}
                loading={sending}
                loadingLabel={t('settingsPage.sending')}
              >
                {t('settingsPage.sendNowModal.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card
        title={t('settingsPage.jurisdictions.title')}
        description={t('settingsPage.jurisdictions.description')}
        footer={
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={handleSaveJurisdictions}
              loading={savingJurisdictions}
              loadingLabel={t('settingsPage.saving')}
              disabled={!jurisdictionsChanged || jurisdictions.length === 0}
            >
              {t('settingsPage.jurisdictions.saveButton')}
            </Button>
            {jurisdictionsChanged && (
              <span className="text-xs text-muted">{t('settingsPage.unsavedChanges')}</span>
            )}
          </div>
        }
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('settingsPage.jurisdictions.title')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SELECTABLE_JURISDICTIONS.map((code) => {
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
                  <span className="truncate text-xs">
                    {t(`settingsPage.jurisdictionLabels.${code}`, { defaultValue: JURISDICTION_LABELS[code] })}
                  </span>
                </label>
              )
            })}
          </div>

          {/* A code stored on the company but no longer offered for new
              selection (currently just LK). It stays visible so an admin can
              see and uncheck it - unchecking removes it here and the removal
              persists on save - but it is never shown among the selectable
              options above, so it cannot be re-added. */}
          {deprecatedJurisdictions.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {deprecatedJurisdictions.map((code) => (
                <label
                  key={code}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-gold-200 bg-gold-50 px-3 py-2.5 text-sm transition-colors"
                >
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleJurisdiction(code)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium text-charcoal">{code}</span>
                  <span className="truncate text-xs">
                    {t('settingsPage.jurisdictions.deprecated', {
                      label: t(`settingsPage.jurisdictionLabels.${code}`, {
                        defaultValue: JURISDICTION_LABELS[code] ?? code,
                      }),
                    })}
                  </span>
                </label>
              ))}
            </div>
          )}

          {jurisdictions.length === 0 && (
            <p className="text-xs text-critical">{t('settingsPage.jurisdictions.atLeastOneRequired')}</p>
          )}

          {jurisdictions.length > 1 && strictestJurisdiction && (
            <Alert variant="info" className="mt-1">
              <Trans
                i18nKey="settingsPage.jurisdictions.strictestNotice"
                values={{ jurisdiction: strictestJurisdiction }}
                components={{ strong: <strong /> }}
              />
            </Alert>
          )}

          {jurisdictionsChanged && (
            <Alert variant="warning" className="mt-1">
              <Trans
                i18nKey="settingsPage.jurisdictions.changeNotice"
                components={{ strong: <strong /> }}
              />
            </Alert>
          )}
        </fieldset>

        <fieldset className="mt-5 flex flex-col gap-2 border-t border-line pt-5">
          <legend className="sr-only">{t('settingsPage.timeZone.title')}</legend>
          <label className="flex flex-col gap-1.5 text-sm sm:max-w-sm">
            <span className="font-medium text-charcoal">{t('settingsPage.timeZone.title')}</span>
            <input
              type="text"
              value={timeZoneInput}
              onChange={(e) => setTimeZoneInput(e.target.value)}
              placeholder="e.g. Asia/Tokyo"
              className="field"
              autoComplete="off"
            />
          </label>
          <p className="text-xs text-muted">
            {timeZoneLocalLabel ?? t('settingsPage.timeZone.enterHint')} {t('settingsPage.timeZone.decidesHint')}
          </p>
          {!timeZoneValid && (
            <p className="text-xs text-critical">{t('settingsPage.timeZone.invalid')}</p>
          )}
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="secondary"
              onClick={handleSaveTimeZone}
              loading={savingTimeZone}
              loadingLabel={t('settingsPage.saving')}
              disabled={!timeZoneChanged || !timeZoneValid || timeZoneTrimmed.length === 0}
            >
              {t('settingsPage.timeZone.saveButton')}
            </Button>
            {timeZoneChanged && <span className="text-xs text-muted">{t('settingsPage.unsavedChanges')}</span>}
          </div>
        </fieldset>
      </Card>

      <Card
        title={t('settingsPage.followUp.title')}
        description={t('settingsPage.followUp.description')}
        footer={
          <Button
            variant="primary"
            onClick={handleSaveFollowUp}
            loading={savingFollowUp}
            loadingLabel={t('settingsPage.saving')}
          >
            {t('settingsPage.followUp.saveButton')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm sm:max-w-md">
            <span className="font-medium text-charcoal">{t('settingsPage.followUp.daysLabel')}</span>
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
                ? t('settingsPage.followUp.noneWillSend')
                : t('settingsPage.followUp.checkInsSummary', {
                    count: parsedIntervals.length,
                    days: parsedIntervals.join(', '),
                  })}
            </span>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-charcoal">{t('settingsPage.followUp.categoriesLegend')}</legend>
            <p className="text-xs text-muted">{t('settingsPage.followUp.categoriesHint')}</p>
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
                    <span className="font-medium text-charcoal">
                      {t(`categories.${code}.label`, { defaultValue: CATEGORY_LABELS[code] })}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <Alert variant="info">{t('settingsPage.followUp.neutralNotice')}</Alert>
        </div>
      </Card>
    </div>
  )
}

export default SettingsPage
