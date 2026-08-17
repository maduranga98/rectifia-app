import { useTranslation } from 'react-i18next'
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS, hasExplicitFeatureFlag, resolveFeatureFlag } from '../../config/featureFlags'
import { PLAN_TIER_SUMMARIES, PULSE_CHECK_BANDS, planIncludesFeature } from '../../config/pricingConfig'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Icon from '../ui/Icon'

// One column of the plan comparison grid. Self-contained on purpose - every
// feature the tier includes is listed here (via planIncludesFeature), not
// just what's new versus the tier below it, so a visitor can read any single
// card and know exactly what that plan gets without cross-referencing
// another column.
function TierCard({ summary, isCurrentTier, t, formatCurrency }) {
  const { tier, label, minEmployees, maxEmployees, monthlyPrice, startingAt } = summary
  const headcountRange = maxEmployees
    ? t('planFeatures.tierRange', { min: minEmployees, max: maxEmployees })
    : t('planFeatures.tierRangeOpenEnded', { min: minEmployees })

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        isCurrentTier ? 'border-navy bg-navy-50/60' : 'border-line-soft'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-charcoal">{label}</p>
        {isCurrentTier && (
          <Badge tone="tone-info" icon="check">
            {t('planFeatures.currentPlan')}
          </Badge>
        )}
      </div>

      <div>
        {monthlyPrice != null ? (
          <p className="text-xl font-semibold tabular-nums text-charcoal">
            {formatCurrency(monthlyPrice)}
            <span className="text-sm font-normal text-muted">{t('billingQuote.perMonth')}</span>
          </p>
        ) : (
          <p className="text-xl font-semibold tabular-nums text-charcoal">
            {t('planFeatures.startingAt', { amount: formatCurrency(startingAt.baseFee) })}
            <span className="text-sm font-normal text-muted"> {t('billingQuote.perMonth')}</span>
          </p>
        )}
        <p className="text-xs text-muted">{headcountRange}</p>
        {startingAt && (
          <p className="text-xs text-muted">
            {t('planFeatures.plusPerEmployee', { rate: formatCurrency(startingAt.ratePerEmployee) })}
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {FEATURE_FLAG_KEYS.filter((key) => key !== 'pulseCheck').map((key) => {
          const included = planIncludesFeature(tier, key)
          return (
            <li key={key} className="flex items-start gap-2 text-xs">
              <Icon
                name={included ? 'check' : 'close'}
                className={`mt-0.5 h-3 w-3 shrink-0 ${included ? 'text-[var(--color-low)]' : 'text-muted opacity-50'}`}
              />
              <span className={included ? 'text-charcoal' : 'text-muted'}>{FEATURE_FLAGS[key].label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// The Pulse Check row is purely informational: whether the add-on is active
// for this company is decided by companies/{companyId}.featureFlags.pulseCheck
// (resolveFeatureFlag), which changes via a Super Admin override, a Company
// Admin's own toggle once they have a subscription
// (updatePulseCheckSubscription.js, see BillingQuote.jsx's
// ActiveSubscriptionSummary), or stripeWebhook.js reconciling a subscription's
// actual item state either way. This card never renders a purchase/cancel
// action of its own - that control lives on BillingQuote.jsx, either as the
// toggle above (once subscribed) or the Subscribe/Request-a-quote flow
// (before). `employeeCount` may be 0/unknown (no declared headcount yet), in
// which case the flat starting rate is shown instead of a computed total.
function PulseCheckRow({ pulseCheckActive, pulseCheckAddOnPrice, employeeCount, formatCurrency, t }) {
  return (
    <div className="rounded-xl border border-line-soft p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-charcoal">{FEATURE_FLAGS.pulseCheck.label}</p>
            <Badge tone="tone-info">{t('planFeatures.addOn')}</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{FEATURE_FLAGS.pulseCheck.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <Badge tone={pulseCheckActive ? 'tone-low' : 'tone-neutral'} icon={pulseCheckActive ? 'check' : 'lock'}>
            {pulseCheckActive ? t('planFeatures.active') : t('planFeatures.notPurchased')}
          </Badge>
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            {employeeCount > 0
              ? `${formatCurrency(pulseCheckAddOnPrice)}${t('billingQuote.perMonth')}`
              : `${t('planFeatures.startingAt', { amount: formatCurrency(PULSE_CHECK_BANDS[0].monthlyPrice) })}${t('billingQuote.perMonth')}`}
          </p>
        </div>
      </div>
    </div>
  )
}

// The list of any explicit company overrides currently in effect - a
// feature granted above what the current tier normally includes, or one
// turned off below it. Deliberately separate from the plan grid above:
// overrides are the exception, not the rule, so they're called out only
// when at least one exists rather than annotated into every grid cell.
function OverridesNote({ companyFlags, t }) {
  if (!companyFlags) return null

  const overrides = FEATURE_FLAG_KEYS.filter(
    (key) => key !== 'pulseCheck' && hasExplicitFeatureFlag(companyFlags, key)
  ).map((key) => ({ key, enabled: resolveFeatureFlag(companyFlags, key) }))

  if (overrides.length === 0) return null

  return (
    <div className="mt-4 rounded-lg border border-line-soft bg-navy-50/40 px-3.5 py-3 text-xs">
      <p className="font-semibold text-charcoal">{t('planFeatures.overridesTitle')}</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {overrides.map(({ key, enabled }) => (
          <li key={key} className="text-muted">
            {FEATURE_FLAGS[key].label}: <span className="text-charcoal">{enabled ? t('planFeatures.grantedException') : t('planFeatures.turnedOff')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// `tier` is the company's current reference tier if a live reference quote
// exists (null when there's no declared headcount yet - see BillingQuote.jsx,
// which renders this card either way so a company can see what plans and the
// Pulse Check add-on look like before declaring one).
// `companyFlags` is companies/{companyId}.featureFlags as loaded from the
// company doc (may be undefined) - the only thing this card reads to decide
// what's actually active; see PulseCheckRow's comment above for why there is
// no purchase action wired up here.
function PlanFeaturesCard({ tier, companyFlags, employeeCount, pulseCheckAddOnPrice, formatCurrency }) {
  const { t } = useTranslation()

  const pulseCheckActive = resolveFeatureFlag(companyFlags, 'pulseCheck')

  return (
    <Card title={t('planFeatures.title')} description={t('planFeatures.description')}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_TIER_SUMMARIES.map((summary) => (
          <TierCard
            key={summary.tier}
            summary={summary}
            isCurrentTier={summary.tier === tier}
            t={t}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>

      <div className="mt-4">
        <PulseCheckRow
          pulseCheckActive={pulseCheckActive}
          pulseCheckAddOnPrice={pulseCheckAddOnPrice}
          employeeCount={employeeCount}
          formatCurrency={formatCurrency}
          t={t}
        />
      </div>

      <OverridesNote companyFlags={companyFlags} t={t} />

      <p className="mt-4 text-xs text-muted">{t('planFeatures.footnote')}</p>
    </Card>
  )
}

export default PlanFeaturesCard
