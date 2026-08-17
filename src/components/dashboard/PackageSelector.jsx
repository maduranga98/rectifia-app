import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PROGRESSIVE_THRESHOLD_EMPLOYEES, PUBLISHED_BANDS } from '../../config/pricingConfig'
import { updateCompanyEmployeeCount } from '../../services/companyService'
import { requestEnterpriseQuote, upgradeSubscription } from '../../services/billingService'
import { formatCurrency } from '../../utils/formatCurrency'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { Input } from '../ui/Field'

// v1's only source for a company's headcount: a number the Company Admin
// types in themselves, not derived from the companies/{companyId}/employees
// roster. This is the same declared count the actual Stripe subscription
// shown in BillingQuote.jsx is billed from (see
// functions/src/billing/pricingEngine.js's readDeclaredEmployeeCount()) -
// editing it here changes what the company is charged next sync, not just
// what this card displays. Shown inline so declaring/editing it never
// leaves this card.
function EmployeeCountEditor({ companyId, employeeCount, onSaved }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(employeeCount == null)
  const [value, setValue] = useState(employeeCount != null ? String(employeeCount) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await updateCompanyEmployeeCount(companyId, value)
      setEditing(false)
      await onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-navy-50/60 px-4 py-3">
        <p className="text-sm text-charcoal">{t('packageSelector.declaredHeadcount', { count: employeeCount })}</p>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {t('packageSelector.employeeCount.edit')}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3 rounded-lg border border-line-soft px-4 py-3.5">
      <Input
        type="number"
        min={1}
        step={1}
        label={t('packageSelector.employeeCount.label')}
        hint={t('packageSelector.employeeCount.hint')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
      />
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="accent" loading={saving} loadingLabel={t('packageSelector.employeeCount.saving')}>
          {t('packageSelector.employeeCount.save')}
        </Button>
        {employeeCount != null && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            {t('packageSelector.employeeCount.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}

// One Core band card. Only the band whose range actually contains the
// company's declared employeeCount is ever selectable - the other two
// render as informational and disabled. The click handler only ever tells
// the server which tier was chosen; upgradeSubscription.js re-derives
// eligibility from the company's own stored employeeCount rather than
// trusting anything about "why" this button was enabled, so this
// eligibility check is UX only, not the enforcement.
function BandCard({ band, employeeCount, currentTier, pending, onSelect, t }) {
  const isCurrent = currentTier === band.tier
  const isEligible = employeeCount >= band.minEmployees && employeeCount <= band.maxEmployees
  const currentIndex = PUBLISHED_BANDS.findIndex((b) => b.tier === currentTier)
  const bandIndex = PUBLISHED_BANDS.findIndex((b) => b.tier === band.tier)
  const actionLabel =
    currentIndex === -1
      ? t('packageSelector.actions.activate', { label: band.label })
      : bandIndex > currentIndex
        ? t('packageSelector.actions.upgrade', { label: band.label })
        : t('packageSelector.actions.downgrade', { label: band.label })

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        isCurrent ? 'border-navy bg-navy-50/60' : 'border-line-soft'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-charcoal">{band.label}</p>
        {isCurrent && (
          <Badge tone="tone-info" icon="check">
            {t('packageSelector.currentPlan')}
          </Badge>
        )}
      </div>

      <div>
        <p className="text-xl font-semibold tabular-nums text-charcoal">
          {formatCurrency(band.monthlyPrice)}
          <span className="text-sm font-normal text-muted">{t('billingQuote.perMonth')}</span>
        </p>
        <p className="text-xs text-muted">{t('packageSelector.tierRange', { min: band.minEmployees, max: band.maxEmployees })}</p>
      </div>

      {isCurrent ? (
        <Button size="sm" variant="secondary" disabled>
          {t('packageSelector.currentPlan')}
        </Button>
      ) : isEligible ? (
        <Button
          size="sm"
          variant="accent"
          loading={pending}
          loadingLabel={t('packageSelector.saving')}
          onClick={() => onSelect(band.tier)}
        >
          {actionLabel}
        </Button>
      ) : (
        <p className="text-xs text-muted">{t('packageSelector.notEligible', { min: band.minEmployees, max: band.maxEmployees })}</p>
      )}
    </div>
  )
}

// Company Admin's Core plan self-serve band picker, wired to Module 29's
// published-band pricing (pricingConfig.js). At or below the 500-employee
// self-serve threshold this offers instant upgrade/downgrade between
// Starter/Growth/Scale, constrained to the one band matching the company's
// declared employeeCount; above it, self-serve selection is replaced with a
// "Contact sales" request handled by requestEnterpriseQuote.js, which never
// exposes the enterprise formula or per-employee rates back to this
// component.
//
// Writes companies/{companyId}.subscriptionTier / .subscriptionUpdatedAt via
// upgradeSubscription.js, which also drives the actual Stripe subscription
// shown above by BillingQuote.jsx/BillingPage.jsx (see that function's file
// comment): a company's first band selection has no payment method on file
// yet, so the response carries a `checkoutUrl` that this component redirects
// to instead of just refreshing in place; a later band change updates the
// existing Stripe item's price directly and resolves synchronously.
//
// Proration on a band change uses Stripe's default (create_prorations, a
// mid-cycle switch is charged/credited a prorated amount) - the immediate-
// effect note below is accurate as written, not a placeholder for a
// mid-cycle adjustment that doesn't exist yet.
function PackageSelector({ companyId, company, onChanged }) {
  const { t } = useTranslation()
  const [pendingTier, setPendingTier] = useState(null)
  const [error, setError] = useState(null)
  const [enterpriseRequested, setEnterpriseRequested] = useState(false)
  const [requestingEnterprise, setRequestingEnterprise] = useState(false)

  const employeeCount = Number.isInteger(company?.employeeCount) ? company.employeeCount : null
  const currentTier = company?.subscriptionTier ?? null
  const isEnterpriseRange = employeeCount != null && employeeCount > PROGRESSIVE_THRESHOLD_EMPLOYEES

  async function handleSelect(tier) {
    setPendingTier(tier)
    setError(null)
    try {
      const { checkoutUrl } = await upgradeSubscription(companyId, { target: 'core', tier })
      if (checkoutUrl) {
        // First-ever Core selection: no payment method on file yet, so the
        // server started a Stripe Checkout Session instead of completing
        // synchronously. Leave the page - same redirect BillingPage.jsx's
        // "Set up billing" button uses.
        window.location.href = checkoutUrl
        return
      }
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingTier(null)
    }
  }

  async function handleContactSales() {
    setRequestingEnterprise(true)
    setError(null)
    try {
      await requestEnterpriseQuote(companyId, { target: 'core' })
      setEnterpriseRequested(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setRequestingEnterprise(false)
    }
  }

  return (
    <Card title={t('packageSelector.title')} description={t('packageSelector.description')}>
      <div className="flex flex-col gap-4">
        <EmployeeCountEditor companyId={companyId} employeeCount={employeeCount} onSaved={onChanged} />

        {error && <Alert variant="error">{error}</Alert>}

        {employeeCount != null && (
          <>
            {isEnterpriseRange ? (
              <div className="rounded-xl border border-line-soft p-4">
                <p className="text-sm font-medium text-charcoal">{t('packageSelector.enterprise.title')}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t('packageSelector.enterprise.body')}</p>
                {enterpriseRequested ? (
                  <Alert variant="success" className="mt-3">
                    {t('packageSelector.enterprise.requested')}
                  </Alert>
                ) : (
                  <div className="mt-3">
                    <Button
                      variant="accent"
                      loading={requestingEnterprise}
                      loadingLabel={t('packageSelector.enterprise.requesting')}
                      onClick={handleContactSales}
                    >
                      {t('packageSelector.enterprise.cta')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {PUBLISHED_BANDS.map((band) => (
                    <BandCard
                      key={band.tier}
                      band={band}
                      employeeCount={employeeCount}
                      currentTier={currentTier}
                      pending={pendingTier === band.tier}
                      onSelect={handleSelect}
                      t={t}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted">{t('packageSelector.immediateEffectNote')}</p>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

export default PackageSelector
