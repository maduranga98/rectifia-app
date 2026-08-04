import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  JURISDICTIONS,
  PULSE_CADENCES,
  getCompany,
  getStrictestJurisdiction,
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
  if (!ms) return 'Never'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [savingCadence, setSavingCadence] = useState(false)

  // Jurisdiction edits are staged locally and saved explicitly, so an admin
  // toggling several jurisdictions triggers one write - and one deadline
  // warning - rather than a write per checkbox.
  const [jurisdictions, setJurisdictions] = useState([])
  const [savingJurisdictions, setSavingJurisdictions] = useState(false)

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
      setRosterSize(employees.filter((e) => e.status !== 'inactive').length)
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

  const cadence = cadenceOf(company)
  const strictestJurisdiction = getStrictestJurisdiction(jurisdictions)
  const savedJurisdictions = company?.jurisdictions ?? []
  const jurisdictionsChanged = !sameSet(jurisdictions, savedJurisdictions)

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
        Company-wide settings: how often Pulse Checks go out, and which jurisdictions drive
        compliance deadlines.
      </p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

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

          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Active roster"
              value={rosterSize}
              icon="staff"
              tone={rosterSize > 0 ? 'tone-info' : 'tone-neutral'}
              hint="People a send would reach"
            />
            <StatTile
              label="Last sent"
              value={formatDateTime(company?.lastPulseCheckSentAt)}
              icon="clock"
              tone="tone-neutral"
            />
          </div>

          {rosterSize === 0 && cadence !== 'off' && (
            <Alert variant="warning" title="No one on the roster">
              This cadence will send to nobody until you add employees. Add them on the{' '}
              <Link to="/admin/employees" className="font-medium underline">
                Employees
              </Link>{' '}
              page.
            </Alert>
          )}
        </div>
      </Card>

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
    </div>
  )
}

export default SettingsPage
