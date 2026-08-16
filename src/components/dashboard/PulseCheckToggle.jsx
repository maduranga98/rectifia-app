import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROGRESSIVE_THRESHOLD_EMPLOYEES, pulseCheckBandForEmployeeCount } from '../../config/pricingConfig'
import { requestEnterpriseQuote, upgradeSubscription } from '../../services/billingService'
import { formatCurrency } from '../../utils/formatCurrency'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'

// Styled switch, same shape as FeatureFlagPanel.jsx's - the only other
// on/off control in the app - reused here rather than a new UI primitive
// for a single control.
function ToggleSwitch({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-navy' : 'bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-card transition-transform ${
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

// Pulse Check's self-serve band picker, deliberately a fully separate
// component and card from PackageSelector (Core) - never rendered inside
// it, never sums or displays a combined price with it, and given its own
// gold-accented border so it visually reads as a distinct add-on rather
// than part of the Core plan. Follows the exact same under-500/500+ split
// as Core (PULSE_CHECK_BANDS vs. requestEnterpriseQuote's contact-sales
// path), but writes and reads its own pair of fields -
// companies/{companyId}.pulseCheckEnabled / .pulseCheckTier - entirely
// independent of subscriptionTier, so a company can change one without
// touching the other.
//
// Reads the same declared companies/{companyId}.employeeCount
// PackageSelector's card manages; this component has no employee-count
// input of its own to avoid two disagreeing entry points for the same
// number.
//
// TODO(proration): same as PackageSelector - turning this on/off or moving
// bands applies immediately with no prorated charge or credit yet. See
// upgradeSubscription.js's matching TODO.
function PulseCheckToggle({ companyId, company, onChanged }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const [enterpriseRequested, setEnterpriseRequested] = useState(false)
  const [requestingEnterprise, setRequestingEnterprise] = useState(false)

  const employeeCount = Number.isInteger(company?.employeeCount) ? company.employeeCount : null
  const enabled = Boolean(company?.pulseCheckEnabled)
  const currentTier = company?.pulseCheckTier ?? null
  const isEnterpriseRange = employeeCount != null && employeeCount > PROGRESSIVE_THRESHOLD_EMPLOYEES
  const matchedBand = employeeCount != null ? pulseCheckBandForEmployeeCount(employeeCount) : null

  async function handleDisable() {
    setPending(true)
    setError(null)
    try {
      await upgradeSubscription(companyId, { target: 'pulseCheck', enable: false })
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function handleActivate(tier) {
    setPending(true)
    setError(null)
    try {
      await upgradeSubscription(companyId, { target: 'pulseCheck', tier })
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  function handleToggle(next) {
    if (!next) {
      handleDisable()
      return
    }
    if (isEnterpriseRange || !matchedBand) return
    handleActivate(matchedBand.tier)
  }

  async function handleContactSales() {
    setRequestingEnterprise(true)
    setError(null)
    try {
      await requestEnterpriseQuote(companyId, { target: 'pulseCheck' })
      setEnterpriseRequested(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setRequestingEnterprise(false)
    }
  }

  return (
    <section className="card overflow-hidden border-gold-200 bg-gold-50/40">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gold-200 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-charcoal">{t('pulseCheckToggle.title')}</h3>
            <Badge tone="tone-high">{t('pulseCheckToggle.separateBadge')}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">{t('pulseCheckToggle.description')}</p>
        </div>
        <ToggleSwitch
          checked={enabled}
          disabled={pending || employeeCount == null}
          onChange={handleToggle}
          label={t('pulseCheckToggle.title')}
        />
      </header>

      <div className="flex flex-col gap-3 px-5 py-4">
        {employeeCount == null && <Alert variant="info">{t('pulseCheckToggle.needsEmployeeCount')}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}

        {employeeCount != null && isEnterpriseRange && (
          <div className="rounded-xl border border-line-soft p-4">
            <p className="text-sm font-medium text-charcoal">{t('pulseCheckToggle.enterprise.title')}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{t('pulseCheckToggle.enterprise.body')}</p>
            {enterpriseRequested ? (
              <Alert variant="success" className="mt-3">
                {t('pulseCheckToggle.enterprise.requested')}
              </Alert>
            ) : (
              <div className="mt-3">
                <Button
                  variant="accent"
                  loading={requestingEnterprise}
                  loadingLabel={t('pulseCheckToggle.enterprise.requesting')}
                  onClick={handleContactSales}
                >
                  {t('pulseCheckToggle.enterprise.cta')}
                </Button>
              </div>
            )}
            {enabled && <p className="mt-2 text-xs text-muted">{t('pulseCheckToggle.enterprise.disableStillWorks')}</p>}
          </div>
        )}

        {employeeCount != null && !isEnterpriseRange && matchedBand && (
          <div className="rounded-xl border border-line-soft p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-charcoal">{matchedBand.label}</p>
              {enabled && currentTier === matchedBand.tier && (
                <Badge tone="tone-low" icon="check">
                  {t('pulseCheckToggle.active')}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums text-charcoal">
              {formatCurrency(matchedBand.monthlyPrice)}
              <span className="text-sm font-normal text-muted">{t('billingQuote.perMonth')}</span>
            </p>
            <p className="text-xs text-muted">
              {t('packageSelector.tierRange', { min: matchedBand.minEmployees, max: matchedBand.maxEmployees })}
            </p>
            {enabled && currentTier !== matchedBand.tier && (
              <div className="mt-3">
                <Button size="sm" variant="accent" loading={pending} loadingLabel={t('packageSelector.saving')} onClick={() => handleActivate(matchedBand.tier)}>
                  {t('pulseCheckToggle.updateToBand', { label: matchedBand.label })}
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted">{t('pulseCheckToggle.neverBundledNote')}</p>
        <p className="text-xs text-muted">{t('packageSelector.immediateEffectNote')}</p>
      </div>
    </section>
  )
}

export default PulseCheckToggle
