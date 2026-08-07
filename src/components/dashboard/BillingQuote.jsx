import { useCallback, useEffect, useState } from 'react'
import { getCompanyQuote } from '../../services/billingService'
import { calculateMonthlyPrice } from '../../utils/pricingCalculator'
import Alert from '../ui/Alert'
import Card from '../ui/Card'
import StatTile from '../ui/StatTile'
import { Input } from '../ui/Field'
import { SkeletonStats } from '../ui/Loading'

const TIER_LABELS = {
  starter: 'Starter',
  growth: 'Growth',
  scale: 'Scale',
  enterprise: 'Enterprise',
}

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
  return (
    <ul className="flex flex-col divide-y divide-line-soft rounded-lg border border-line-soft">
      {breakdown.map((line, index) => (
        <li key={index} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
          <span className="text-charcoal">
            {line.label}
            {line.employees != null && (
              <span className="text-muted">
                {' '}
                ({line.employees.toLocaleString()} {line.employees === 1 ? 'employee' : 'employees'}
                {line.ratePerEmployee != null ? ` @ ${formatCurrency(line.ratePerEmployee)}` : ''})
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
  const [current, setCurrent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [projectedInput, setProjectedInput] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getCompanyQuote(companyId)
      setCurrent(result)
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
      <Alert variant="info" title="No billable headcount yet">
        Add employees to your roster on the Employees page to see a billing quote.
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
      projectionError = 'Enter a whole number of employees'
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card padded={false} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Current tier</p>
            <p className="mt-1 text-2xl font-semibold text-charcoal">
              {TIER_LABELS[quote.tier] ?? quote.tier}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Current monthly price</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-charcoal">
              {formatCurrency(quote.monthlyPrice)}
              <span className="text-sm font-normal text-muted">/mo</span>
            </p>
          </div>
        </div>
      </Card>

      {quote.needsManualReview && (
        <Alert variant="warning" title="Flagged for manual sales review">
          At this headcount, pricing above 5,000 employees is reviewed by the Rectifia sales team rather
          than fully automated. The estimate below is shown for transparency but is not a final quote.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          label="Active employees"
          value={employeeCount.toLocaleString()}
          tone="tone-neutral"
          icon="staff"
        />
        <StatTile
          label="Effective rate per employee"
          value={formatCurrency(quote.effectiveRatePerEmployee)}
          tone="tone-info"
          icon="billing"
          hint="Blended: monthly price ÷ active employees"
        />
      </div>

      <Card title="Price breakdown" description="How your current monthly price was built.">
        <BreakdownReceipt breakdown={quote.breakdown} />
      </Card>

      <Card
        title="Pulse Check add-on"
        description="Billed separately from your core plan, at a flat per-employee rate."
      >
        <div className="flex items-center justify-between text-sm">
          <span className="text-charcoal">{employeeCount.toLocaleString()} employees</span>
          <span className="font-medium tabular-nums text-charcoal">
            {formatCurrency(pulseCheckAddOnPrice)}/mo
          </span>
        </div>
      </Card>

      <Card
        title="What if we grow?"
        description="See your projected price at a future headcount before it happens - no cliffs, no surprise invoice."
      >
        <div className="flex flex-col gap-4">
          <Input
            type="number"
            min={1}
            step={1}
            label="Projected headcount"
            placeholder={String(employeeCount)}
            value={projectedInput}
            onChange={(e) => setProjectedInput(e.target.value)}
          />

          {projectionError && <Alert variant="error">{projectionError}</Alert>}

          {projectedQuote && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-navy-50/60 px-4 py-3">
                <span className="text-sm text-muted">
                  Projected tier: <span className="font-medium text-charcoal">{TIER_LABELS[projectedQuote.tier] ?? projectedQuote.tier}</span>
                </span>
                <span className="text-xl font-semibold tabular-nums text-charcoal">
                  {formatCurrency(projectedQuote.monthlyPrice)}
                  <span className="text-sm font-normal text-muted">/mo</span>
                </span>
              </div>

              {projectedQuote.needsManualReview && (
                <Alert variant="warning">
                  This projection is above the 5,000-employee threshold where pricing moves to manual
                  sales review - treat this figure as an estimate, not a locked-in price.
                </Alert>
              )}

              <BreakdownReceipt breakdown={projectedQuote.breakdown} />

              <p className="text-xs text-muted">
                This projection is calculated instantly in your browser for planning purposes. Your actual
                bill is always recalculated from your real roster at invoicing time.
              </p>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

export default BillingQuote
