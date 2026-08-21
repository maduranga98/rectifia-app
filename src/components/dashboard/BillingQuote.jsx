import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createCheckoutSession,
  getCompanyQuote,
  getSubscriptionSummary,
  updateDeclaredHeadcount,
  updatePulseCheckSubscription,
  upgradeSubscriptionTier,
} from '../../services/billingService'
import { getCompany, updateCompanyEmployeeCount } from '../../services/companyService'
import { listEmployees } from '../../services/employeeService'
import { calculateMonthlyPrice, calculatePulseCheckAddOnPrice } from '../../utils/pricingCalculator'
import {
  PROGRESSIVE_THRESHOLD_EMPLOYEES,
  MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES,
  PUBLISHED_BANDS,
} from '../../config/pricingConfig'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import StatTile from '../ui/StatTile'
import { Input } from '../ui/Field'
import { SkeletonStats } from '../ui/Loading'
import PlanFeaturesCard from './PlanFeaturesCard'

function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// getSubscriptionSummary.js returns whole-currency-unit cents (Stripe's own
// unit), never dollars - this is the one place that gets converted back to
// a plain number for formatCurrency() above.
function formatCurrencyFromCents(cents, currency) {
  return formatCurrency(cents / 100, (currency || 'usd').toUpperCase())
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

// The manually-declared estimate: a number the Company Admin types in
// themselves, not derived from the companies/{companyId}/employees roster.
// Only rendered for a company with no real roster yet (see BillingQuote's
// noRosterYet branch below) - once a real roster exists, it drives the
// reference quote instead and this editor is not shown. Declaring/editing
// it here is what changes the reference quote below and what a quote
// request (BillingPage.jsx) is filed at for a rosterless company - it never
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
// `employeeCount`/`quote`/`source` below come straight from
// calculateQuote.js's response, which is computed from
// pricingEngine.js's resolveEffectiveEmployeeCount(): the real Pulse Check
// roster whenever the company has one, the self-declared estimate only as a
// fallback for a company with no roster yet. `source` ('roster' | 'declared')
// says which one produced this quote, so the UI can label the number
// correctly instead of presenting an estimate as if it were exact. The
// employee-count editor below is this component's own - the
// package-selection UI that used to own it (PackageSelector.jsx) is gone,
// but a rosterless prospect still needs a way to declare/update the number
// their reference quote and a quote request are computed from.

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

// Only rendered inside ActiveSubscriptionSummary for a company whose
// subscription is priced from a self-declared headcount
// (company.billingHeadcountSource === 'declared', Module 29J) - a
// roster-priced company (or one predating 29J, no field at all) gets none of
// this and the card stays exactly as it was before this control existed. A
// declared-count company has no roster to move its tier off of the way the
// cap-triggered "Upgrade plan" action above does, so this is its own way to
// re-declare that number and, via updateDeclaredHeadcount(), move the Core
// tier up OR down to match. The attestation checkbox is required on every
// submit, not only a changed one - re-declaring the same number is still a
// deliberate "yes, this is still accurate" affirmation. On a tier change,
// confirms the resulting price with a fresh getSubscriptionSummary() call
// (Module 29I's live-price fetch) rather than trusting the reference formula.
function DeclaredHeadcountCard({ companyId, company, onChanged }) {
  const { t } = useTranslation()
  const employeeCount = company?.employeeCount ?? null
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(employeeCount != null ? String(employeeCount) : '')
  const [attested, setAttested] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const outcome = await updateDeclaredHeadcount(companyId, value)
      let priceLine = null
      if (outcome.changed) {
        try {
          const summary = await getSubscriptionSummary(companyId)
          priceLine = { cents: summary.totalPriceCents, currency: summary.currency }
        } catch {
          priceLine = null
        }
      }
      setResult({ ...outcome, priceLine })
      setEditing(false)
      setAttested(false)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line-soft pt-4">
      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-charcoal">
            {t('billingQuote.activeSubscription.declaredHeadcount.current', { count: employeeCount ?? 0 })}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t('billingQuote.employeeCount.edit')}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-3 rounded-lg border border-line-soft px-4 py-3.5">
          <Input
            type="number"
            min={1}
            step={1}
            label={t('billingQuote.employeeCount.label')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <label className="flex items-start gap-2 text-sm text-charcoal">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            {t('billingQuote.activeSubscription.declaredHeadcount.attestation')}
          </label>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              variant="accent"
              loading={saving}
              loadingLabel={t('billingQuote.employeeCount.saving')}
              disabled={!attested}
            >
              {t('billingQuote.employeeCount.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              {t('billingQuote.employeeCount.cancel')}
            </Button>
          </div>
        </form>
      )}

      {result && (
        <Alert variant={result.changed ? 'success' : 'info'}>
          {result.changed
            ? t('billingQuote.activeSubscription.declaredHeadcount.tierChanged', {
                fromTier: subscriptionTierLabel(t, result.previousTier),
                toTier: subscriptionTierLabel(t, result.subscriptionTier),
                price: result.priceLine
                  ? formatCurrencyFromCents(result.priceLine.cents, result.priceLine.currency)
                  : '—',
              })
            : t('billingQuote.activeSubscription.declaredHeadcount.reconfirmed')}
        </Alert>
      )}
    </div>
  )
}

// An active paying customer (company.stripeSubscriptionId exists - see
// BillingPage.jsx's file comment for why that field, not billingStatus, is
// the source of truth). Shows the plan/tier and status a Lumora staffer set
// by hand (or, for a self-serve subscription, that createCheckoutSession.js/
// stripeWebhook.js/upgradeSubscriptionTier.js set); deliberately does not
// recompute or display a price from the reference formula below
// (calculateMonthlyPrice/calculateQuote.js) - that formula is published-rate
// reference pricing for a prospect, not what an already-provisioned
// subscription actually charges. An actual price for this state would have
// to come from the live Stripe subscription itself, which nothing here
// fetches.
//
// Also the self-serve management surface for an active subscription: a
// Pulse Check on/off toggle (updatePulseCheckSubscription.js) and, once the
// real roster is near or at the plan's headcount cap (the same cap
// addEmployee.js enforces), an explicit "Upgrade plan" action
// (upgradeSubscriptionTier.js) - never triggered automatically.
// `realHeadcount` is the roster's real size, not the self-declared
// employeeCount the reference-quote flow below this card uses.
function ActiveSubscriptionSummary({ company, companyId, realHeadcount, onChanged }) {
  const { t } = useTranslation()
  const status = company?.billingStatus ?? 'unknown'
  const pulseCheckActive = Boolean(company?.featureFlags?.pulseCheck)
  const [pulseCheckPending, setPulseCheckPending] = useState(false)
  const [upgradePending, setUpgradePending] = useState(false)
  const [actionError, setActionError] = useState(null)

  // The live Stripe price - fetched fresh on every mount (never cached in
  // Firestore, per getSubscriptionSummary.js) and kept separate from the
  // rest of this card's state: a failed fetch (network error, etc.) should
  // just drop the price line, never block the tier/status card above from
  // rendering.
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setSummaryLoading(true)
    getSubscriptionSummary(companyId)
      .then((result) => {
        if (!cancelled) setSummary(result)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  const band = PUBLISHED_BANDS.find((b) => b.tier === company?.subscriptionTier) ?? null
  const cap = band?.maxEmployees ?? null
  const nearCap = cap != null && realHeadcount != null && realHeadcount >= cap - Math.max(2, Math.round(cap * 0.1))
  const atCap = cap != null && realHeadcount != null && realHeadcount >= cap

  async function handleTogglePulseCheck() {
    setPulseCheckPending(true)
    setActionError(null)
    try {
      await updatePulseCheckSubscription(companyId, !pulseCheckActive)
      await onChanged()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setPulseCheckPending(false)
    }
  }

  async function handleUpgrade() {
    setUpgradePending(true)
    setActionError(null)
    try {
      await upgradeSubscriptionTier(companyId)
      await onChanged()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setUpgradePending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
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

        {company?.billingHeadcountSource === 'declared' && (
          <DeclaredHeadcountCard companyId={companyId} company={company} onChanged={onChanged} />
        )}

        {summaryLoading ? (
          <div className="mt-4 border-t border-line-soft pt-4">
            <SkeletonStats count={1} />
          </div>
        ) : (
          summary && (
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t border-line-soft pt-4">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  {t('billingQuote.activeSubscription.currentPrice')}
                </p>
                {summary.pulseCheckPriceCents != null && (
                  <>
                    <p className="text-xs text-muted">
                      {t('billingQuote.activeSubscription.coreLine', {
                        price: formatCurrencyFromCents(summary.corePriceCents, summary.currency),
                      })}
                    </p>
                    <p className="text-xs text-muted">
                      {t('billingQuote.activeSubscription.pulseCheckLine', {
                        price: formatCurrencyFromCents(summary.pulseCheckPriceCents, summary.currency),
                      })}
                    </p>
                  </>
                )}
                {summary.currentPeriodEnd != null && (
                  <p className="text-xs text-muted">
                    {t('billingQuote.activeSubscription.renewsOn', {
                      date: new Date(summary.currentPeriodEnd * 1000).toLocaleDateString(),
                    })}
                  </p>
                )}
              </div>
              <p className="text-2xl font-semibold tabular-nums text-charcoal">
                {formatCurrencyFromCents(summary.totalPriceCents, summary.currency)}
                <span className="text-sm font-normal text-muted">{t('billingQuote.perMonth')}</span>
              </p>
            </div>
          )
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
          <div>
            <p className="text-sm font-medium text-charcoal">{t('billingQuote.activeSubscription.pulseCheck.label')}</p>
            <p className="text-xs text-muted">
              {pulseCheckActive ? t('planFeatures.active') : t('planFeatures.notPurchased')}
            </p>
          </div>
          <Button
            size="sm"
            variant={pulseCheckActive ? 'dangerGhost' : 'secondary'}
            loading={pulseCheckPending}
            loadingLabel={t('billingQuote.activeSubscription.pulseCheck.updating')}
            onClick={handleTogglePulseCheck}
          >
            {pulseCheckActive
              ? t('billingQuote.activeSubscription.pulseCheck.disable')
              : t('billingQuote.activeSubscription.pulseCheck.enable')}
          </Button>
        </div>

        {cap != null && nearCap && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
            <p className="text-xs text-muted">
              {atCap
                ? t('billingQuote.activeSubscription.cap.atCap', { cap })
                : t('billingQuote.activeSubscription.cap.nearCap', { current: realHeadcount, cap })}
            </p>
            <Button
              size="sm"
              variant="accent"
              loading={upgradePending}
              loadingLabel={t('billingQuote.activeSubscription.cap.upgrading')}
              onClick={handleUpgrade}
            >
              {t('billingQuote.activeSubscription.cap.upgrade')}
            </Button>
          </div>
        )}
      </Card>

      {actionError && <Alert variant="error">{actionError}</Alert>}
    </div>
  )
}

// Primary action for a company with no subscription yet, at or below the
// 500-employee self-serve ceiling (PROGRESSIVE_THRESHOLD_EMPLOYEES) - only
// rendered by BillingQuote in that state. Priced off `employeeCount`, which
// the caller resolves the same way createCheckoutSession.js itself does
// (Module 29J): the REAL roster whenever the company has one (`source`
// 'roster'), falling back to the self-declared estimate only for a company
// with no roster yet (`source` 'declared') - createCheckoutSession.js
// re-derives and validates this same number server-side rather than trusting
// what's passed here, and records which source priced the checkout as
// company.billingHeadcountSource for every later billing callable to key off
// of. Above the ceiling, BillingQuote does not render this card at all -
// only the reference quote plus the "Request a quote" action (BillingPage.jsx)
// for a company above the ceiling or that wants a negotiated deal instead of
// self-serve checkout.
function SubscribeCard({ companyId, employeeCount, source }) {
  const { t } = useTranslation()
  const [includePulseCheck, setIncludePulseCheck] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  const priced = calculateMonthlyPrice(employeeCount)
  const pulseCheckPrice = calculatePulseCheckAddOnPrice(employeeCount)

  async function handleSubscribe() {
    setPending(true)
    setError(null)
    try {
      const { url } = await createCheckoutSession(companyId, { includePulseCheck })
      window.location.href = url
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <Card padded={false} className="p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-charcoal">{t('billingQuote.subscribeCard.title')}</p>
            <p className="mt-1 text-sm text-muted">
              {t(
                source === 'declared' ? 'billingQuote.subscribeCard.declaredBody' : 'billingQuote.subscribeCard.body',
                { count: employeeCount, tier: t(`billingQuote.tierLabels.${priced.tier}`, { defaultValue: priced.tier }) }
              )}
            </p>
          </div>
          <p className="text-2xl font-semibold tabular-nums text-charcoal">
            {formatCurrency(priced.monthlyPrice)}
            <span className="text-sm font-normal text-muted">{t('billingQuote.perMonth')}</span>
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-charcoal">
          <input
            type="checkbox"
            checked={includePulseCheck}
            onChange={(e) => setIncludePulseCheck(e.target.checked)}
          />
          {t('billingQuote.subscribeCard.pulseCheckLabel', { price: pulseCheckPrice })}
        </label>

        {error && <Alert variant="error">{error}</Alert>}

        <div>
          <Button
            variant="accent"
            loading={pending}
            loadingLabel={t('billingQuote.subscribeCard.subscribing')}
            onClick={handleSubscribe}
          >
            {t('billingQuote.subscribeCard.subscribeButton')}
          </Button>
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
  const [realHeadcount, setRealHeadcount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [projectedInput, setProjectedInput] = useState('')

  // realHeadcount is the roster's real size (companies/{companyId}/employees)
  // - what createCheckoutSession.js/updatePulseCheckSubscription.js/
  // upgradeSubscriptionTier.js actually price off of, and what
  // resolveEffectiveEmployeeCount() also prefers for `current.employeeCount`
  // whenever it's non-zero. Kept as its own client-side count (rather than
  // trusting company.currentEmployeeCount from `current`) only to decide
  // which of this component's three states to render below.
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [result, companyDoc, employees] = await Promise.all([
        getCompanyQuote(companyId),
        getCompany(companyId),
        listEmployees(companyId),
      ])
      setCurrent(result)
      setCompany(companyDoc)
      setRealHeadcount(employees.length)
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
    return (
      <ActiveSubscriptionSummary
        company={company}
        companyId={companyId}
        realHeadcount={realHeadcount}
        onChanged={refresh}
      />
    )
  }

  const hasQuote = Boolean(current?.quote)
  const employeeCount = current?.employeeCount ?? 0
  const quote = current?.quote ?? null
  const pulseCheckAddOnPrice = current?.pulseCheckAddOnPrice ?? null
  const quoteSource = current?.source ?? null

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

  // Single state machine, keyed off the real roster size
  // (companies/{companyId}/employees, counted client-side into
  // realHeadcount): a company with a real roster gets self-serve subscribe
  // (below the progressive threshold) or a "Request a quote" hand-off
  // (above it), always priced off that same real headcount - never the
  // manually-declared estimate. A company with no roster yet (realHeadcount
  // === 0) is the only state where the self-declared estimate
  // (EmployeeCountEditor) is offered at all - and, since Module 29J, the
  // only state where checkout itself is priced off that declared number
  // (quoteSource === 'declared') instead of being unavailable outright.
  const hasRoster = realHeadcount > 0
  const overSelfServeCeiling = hasRoster && realHeadcount > MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES
  const noRosterYet = realHeadcount === 0
  const canSubscribeOnDeclaredCount =
    noRosterYet && hasQuote && quoteSource === 'declared' && employeeCount <= PROGRESSIVE_THRESHOLD_EMPLOYEES

  return (
    <div className="flex flex-col gap-5">
      {hasRoster && !overSelfServeCeiling && (
        <SubscribeCard companyId={companyId} employeeCount={realHeadcount} source="roster" />
      )}
      {canSubscribeOnDeclaredCount && (
        <SubscribeCard companyId={companyId} employeeCount={employeeCount} source="declared" />
      )}

      <Alert variant="warning" title={t('billingQuote.referenceRateNotice.title')}>
        {t('billingQuote.referenceRateNotice.body')}
      </Alert>

      {noRosterYet && (
        <>
          <Alert variant="info" title={t('billingQuote.onboarding.title')}>
            {t('billingQuote.onboarding.body')}
          </Alert>

          <EmployeeCountEditor
            companyId={companyId}
            employeeCount={current?.employeeCount || null}
            onSaved={refresh}
          />
        </>
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
                <p className="mt-1 text-xs text-muted">
                  {quoteSource === 'roster'
                    ? t('billingQuote.headcountSource.roster')
                    : t('billingQuote.headcountSource.declared')}
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
              label={
                quoteSource === 'roster' ? t('billingQuote.activeEmployees') : t('billingQuote.estimatedEmployees')
              }
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
