import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCompanyQuote } from '../../services/billingService'
import { getCompany } from '../../services/companyService'
import { calculateMonthlyPrice } from '../../utils/pricingCalculator'
import Alert from '../ui/Alert'
import Card from '../ui/Card'
import StatTile from '../ui/StatTile'
import { Input } from '../ui/Field'
import { SkeletonStats } from '../ui/Loading'
import PlanFeaturesCard from './PlanFeaturesCard'

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// The bracket receipt: "First 1,000 @ $1.10 = $1,100", one row per
// contributing band or bracket. Same shape for a flat-band tier (one row, no
// per-employee rate shown) and a progressive tier (base fee plus each
// slice) - transparency into how the number was built, never a case count.
function BreakdownReceipt({ breakdown }) {
  const { t } = useTranslation()
  return (
    <ul className="flex flex-col divide-y divide-line-soft rounded-lg border border-line-soft">
      {breakdown.map((line, index) => (
        <li key={index} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
          <span className="text-charcoal">
            {line.label}
            {line.employees != null && (
              <span className="text-muted">
                {' '}
                (
                {line.ratePerEmployee != null
                  ? t('billingQuote.employeesAtRate', {
                      count: line.employees,
                      rate: formatCurrency(line.ratePerEmployee),
                    })
                  : t('billingQuote.employeesCount', { count: line.employees })}
                )
              </span>
            )}
          </span>
          <span className="shrink-0 font-medium tabular-nums text-charcoal">{formatCurrency(line.amount)}</span>
        </li>
      ))}
    </ul>
  )
}

// Company Admin's billing quote: current tier, current monthly price, the
// bracket breakdown behind that price, and a what-if calculator for
// projected headcount growth. Case volume never appears here - price is a
// function of headcount only, and this panel is read-only (no payment form,
// no plan-change action; see BillingPage.jsx for that boundary).
function BillingQuote({ companyId }) {
  const { t } = useTranslation()
  const TIER_LABELS = {
    starter: t('billingQuote.tierLabels.starter'),
    growth: t('billingQuote.tierLabels.growth'),
    scale: t('billingQuote.tierLabels.scale'),
    enterprise: t('billingQuote.tierLabels.enterprise'),
  }
  const [current, setCurrent] = useState(null)
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [projectedInput, setProjectedInput] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [result, companyDoc] = await Promise.all([getCompanyQuote(companyId), getCompany(companyId)])
      setCurrent(result)
      setCompany(companyDoc)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  if (loading && !current) {
    return <SkeletonStats count={2} />
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>
  }

  if (!current?.quote) {
    return (
      <Alert variant="info" title={t('billingQuote.noHeadcount.title')}>
        {t('billingQuote.noHeadcount.body')}
      </Alert>
    )
  }

  const { employeeCount, quote, pulseCheckAddOnPrice } = current

  const projectedCount = Number.parseInt(projectedInput, 10)
  const hasValidProjection = Number.isFinite(projectedCount) && projectedCount >= 1
  let projectedQuote = null
  let projectionError = null
  if (projectedInput.trim() !== '') {
    if (hasValidProjection) {
      try {
        projectedQuote = calculateMonthlyPrice(projectedCount)
      } catch (err) {
        projectionError = err.message
      }
    } else {
      projectionError = t('billingQuote.enterWholeNumber')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card padded={false} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{t('billingQuote.currentTier')}</p>
            <p className="mt-1 text-2xl font-semibold text-charcoal">
              {TIER_LABELS[quote.tier] ?? quote.tier}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{t('billingQuote.currentMonthlyPrice')}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-charcoal">
              {formatCurrency(quote.monthlyPrice)}
              <span className="text-sm font-normal text-muted">{t('billingQuote.perMonth')}</span>
            </p>
          </div>
        </div>
      </Card>

      {quote.needsManualReview && (
        <Alert variant="warning" title={t('billingQuote.manualReview.title')}>
          {t('billingQuote.manualReview.body')}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          label={t('billingQuote.activeEmployees')}
          value={employeeCount.toLocaleString()}
          tone="tone-neutral"
          icon="staff"
        />
        <StatTile
          label={t('billingQuote.effectiveRate')}
          value={formatCurrency(quote.effectiveRatePerEmployee)}
          tone="tone-info"
          icon="billing"
          hint={t('billingQuote.effectiveRateHint')}
        />
      </div>

      <Card title={t('billingQuote.priceBreakdown.title')} description={t('billingQuote.priceBreakdown.description')}>
        <BreakdownReceipt breakdown={quote.breakdown} />
      </Card>

      <PlanFeaturesCard
        tier={quote.tier}
        companyId={companyId}
        companyFlags={company?.featureFlags ?? null}
        pulseCheckAddOnPrice={pulseCheckAddOnPrice}
        formatCurrency={formatCurrency}
        hasSubscription={Boolean(company?.stripeSubscriptionId)}
        onPulseCheckToggled={refresh}
      />

      <Card
        title={t('billingQuote.whatIfCard.title')}
        description={t('billingQuote.whatIfCard.description')}
      >
        <div className="flex flex-col gap-4">
          <Input
            type="number"
            min={1}
            step={1}
            label={t('billingQuote.whatIfCard.projectedHeadcountLabel')}
            placeholder={String(employeeCount)}
            value={projectedInput}
            onChange={(e) => setProjectedInput(e.target.value)}
          />

          {projectionError && <Alert variant="error">{projectionError}</Alert>}

          {projectedQuote && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-navy-50/60 px-4 py-3">
                <span className="text-sm text-muted">
                  {t('billingQuote.whatIfCard.projectedTier')}{' '}
                  <span className="font-medium text-charcoal">{TIER_LABELS[projectedQuote.tier] ?? projectedQuote.tier}</span>
                </span>
                <span className="text-xl font-semibold tabular-nums text-charcoal">
                  {formatCurrency(projectedQuote.monthlyPrice)}
                  <span className="text-sm font-normal text-muted">{t('billingQuote.perMonth')}</span>
                </span>
              </div>

              {projectedQuote.needsManualReview && (
                <Alert variant="warning">{t('billingQuote.whatIfCard.manualReviewNotice')}</Alert>
              )}

              <BreakdownReceipt breakdown={projectedQuote.breakdown} />

              <p className="text-xs text-muted">{t('billingQuote.whatIfCard.footnote')}</p>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

export default BillingQuote
