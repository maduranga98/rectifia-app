import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCompanyQuote } from '../../services/billingService'
import { getCompany, updateCompanyEmployeeCount } from '../../services/companyService'
import { calculateMonthlyPrice } from '../../utils/pricingCalculator'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
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

// v1's only source for a company's headcount: a number the Company Admin
// types in themselves, not derived from the companies/{companyId}/employees
// roster. Declaring/editing it here is what changes the reference quote
// below and what a quote request (BillingPage.jsx) is filed at - it never
// touches a real Stripe charge itself, since there is none until a human
// sets one up after negotiating a price. Shown inline so declaring/editing
// it never leaves this card.
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
        <p className="text-sm text-charcoal">{t('billingQuote.declaredHeadcount', { count: employeeCount })}</p>
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          {t('billingQuote.employeeCount.edit')}
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
        label={t('billingQuote.employeeCount.label')}
        hint={t('billingQuote.employeeCount.hint')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
      />
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="accent" loading={saving} loadingLabel={t('billingQuote.employeeCount.saving')}>
          {t('billingQuote.employeeCount.save')}
        </Button>
        {employeeCount != null && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
            {t('billingQuote.employeeCount.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}

// Company Admin's billing quote card - branches on whether
// company.stripeSubscriptionId exists (see BillingPage.jsx's file comment
// for why that field, not billingStatus, is the source of truth):
//
//  - No stripeSubscriptionId (a prospect): the REFERENCE quote flow below -
//    current tier, current monthly price, the bracket breakdown behind that
//    price, and a what-if calculator for projected headcount growth, all
//    computed from Rectifia's PUBLISHED rates, never what the company would
//    actually be charged. Pilot v1 has a handful of founding customers on
//    individually negotiated discounts and no self-serve subscription path
//    at all, so every number here carries the "reference rate only" framing
//    below and nothing here is a price-change or payment action - see
//    BillingPage.jsx for the single "Request a quote" action that is
//    available, and its file comment for the full rationale.
//  - stripeSubscriptionId exists (an active paying customer): none of the
//    reference-quote UI applies - see ActiveSubscriptionSummary below.
//
// `employeeCount`/`quote` below come straight from calculateQuote.js's
// response, which is computed from the company's DECLARED headcount
// (companies/{companyId}.employeeCount) - see
// functions/src/billing/pricingEngine.js's readDeclaredEmployeeCount()
// comment for why that field, not the live Pulse Check roster, drives this.
// The employee-count editor below is this component's own - the
// package-selection UI that used to own it (PackageSelector.jsx) is gone,
// but a prospect still needs a way to declare/update the number this
// reference quote and a quote request are computed from.

// Labels for company.subscriptionTier (companyService.js's SUBSCRIPTION_TIERS:
// starter/professional/enterprise, the tier a Lumora staffer set by hand when
// setting up the subscription) - a different vocabulary from TIER_LABELS
// below, which labels quote.tier (the pricingEngine.js headcount bracket a
// REFERENCE quote falls into: starter/growth/scale/enterprise). Never mix
// the two: an active subscriber's plan comes from company.subscriptionTier,
// never from a reference-quote bracket.
function subscriptionTierLabel(t, tier) {
  return t(`billingQuote.subscriptionTierLabels.${tier}`, { defaultValue: tier })
}

// An active paying customer (company.stripeSubscriptionId exists - see
// BillingPage.jsx's file comment for why that field, not billingStatus, is
// the source of truth). Shows the plan/tier and status a Lumora staffer set
// by hand; deliberately does not recompute or display a price from the
// reference formula below (calculateMonthlyPrice/calculateQuote.js) - that
// formula is published-rate reference pricing for a prospect, not what an
// already-negotiated, already-provisioned subscription actually charges. An
// actual price for this state would have to come from the live Stripe
// subscription itself, which nothing here fetches.
function ActiveSubscriptionSummary({ company }) {
  const { t } = useTranslation()
  const status = company?.billingStatus ?? 'unknown'
  return (
    <Card padded={false} className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{t('billingQuote.currentTier')}</p>
          <p className="mt-1 text-2xl font-semibold text-charcoal">
            {company?.subscriptionTier ? subscriptionTierLabel(t, company.subscriptionTier) : t('billingQuote.activeSubscription.unknownTier')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{t('billingPage.subscriptionStatus')}</p>
          <p className="mt-1 text-lg font-semibold text-charcoal">{status.replace(/_/g, ' ')}</p>
        </div>
      </div>
    </Card>
  )
}

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

  const hasStripeSubscription = Boolean(company?.stripeSubscriptionId)

  if (hasStripeSubscription) {
    return <ActiveSubscriptionSummary company={company} />
  }

  const hasQuote = Boolean(current?.quote)
  const employeeCount = current?.employeeCount ?? 0
  const quote = current?.quote ?? null
  const pulseCheckAddOnPrice = current?.pulseCheckAddOnPrice ?? null

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
      <Alert variant="warning" title={t('billingQuote.referenceRateNotice.title')}>
        {t('billingQuote.referenceRateNotice.body')}
      </Alert>

      <EmployeeCountEditor
        companyId={companyId}
        employeeCount={current?.employeeCount || null}
        onSaved={refresh}
      />

      {!hasQuote && (
        <Alert variant="info" title={t('billingQuote.noHeadcount.title')}>
          {t('billingQuote.noHeadcount.body')}
        </Alert>
      )}

      {hasQuote && (
        <>
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
        </>
      )}

      <PlanFeaturesCard
        tier={quote?.tier ?? null}
        companyFlags={company?.featureFlags ?? null}
        employeeCount={employeeCount}
        pulseCheckAddOnPrice={pulseCheckAddOnPrice}
        formatCurrency={formatCurrency}
      />

      {hasQuote && (
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
      )}
    </div>
  )
}

export default BillingQuote
