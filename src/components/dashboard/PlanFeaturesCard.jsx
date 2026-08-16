import { useTranslation } from 'react-i18next'
import { FEATURE_FLAGS, FEATURE_FLAG_KEYS, hasExplicitFeatureFlag, resolveFeatureFlag } from '../../config/featureFlags'
import { PLAN_TIER_ORDER, planIncludesFeature, lowestTierForFeature } from '../../config/pricingConfig'
import Card from '../ui/Card'
import Badge from '../ui/Badge'

// The "what am I getting" half of the price page: every feature flag
// (except pulseCheck, which gets its own row below - it is never part of a
// tier's plan, see pricingConfig.js's PLAN_FEATURES comment) shown against
// the company's current tier, so an admin can see at a glance what their
// plan includes and what the next tier up would unlock.
//
// Included/locked is read from PLAN_FEATURES, the plan side of the picture.
// The actual on/off switch for a company remains companies/{companyId}.
// featureFlags (resolveFeatureFlag) - a Super Admin override always wins, so
// a feature can show as "on" here even while locked by the plan ladder (a
// one-off grant) or "off" even while the plan includes it (a kill switch).
// Both of those are called out explicitly rather than just shown as a plain
// checkmark, so the row never contradicts what the company actually has
// access to right now.
function FeatureRow({ flagKey, entry, tier, companyFlags, t, tierLabel }) {
  const enabled = resolveFeatureFlag(companyFlags, flagKey)
  const isOverride = hasExplicitFeatureFlag(companyFlags, flagKey)
  const includedInPlan = planIncludesFeature(tier, flagKey)

  let badge
  if (isOverride && enabled && !includedInPlan) {
    badge = <Badge tone="tone-info">{t('planFeatures.grantedException')}</Badge>
  } else if (isOverride && !enabled && includedInPlan) {
    badge = <Badge tone="tone-neutral">{t('planFeatures.turnedOff')}</Badge>
  } else if (includedInPlan) {
    badge = (
      <Badge tone="tone-low" icon="check">
        {t('planFeatures.included')}
      </Badge>
    )
  } else {
    const requiredTier = lowestTierForFeature(flagKey)
    badge = (
      <Badge tone="tone-neutral" icon="lock">
        {requiredTier ? t('planFeatures.requiresTier', { tier: tierLabel(requiredTier) }) : t('planFeatures.locked')}
      </Badge>
    )
  }

  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft py-3.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-charcoal">{entry.label}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{entry.description}</p>
      </div>
      <div className="shrink-0">{badge}</div>
    </div>
  )
}

// `tier` is the company's current billing tier (quote.tier from
// getCompanyQuote), `companyFlags` is companies/{companyId}.featureFlags as
// loaded from the company doc (may be undefined). `pulseCheckAddOnPrice` is
// the already-computed per-employee add-on price so this card doesn't
// recompute it.
function PlanFeaturesCard({ tier, companyFlags, pulseCheckAddOnPrice, formatCurrency }) {
  const { t } = useTranslation()
  const tierLabel = (key) => t(`billingQuote.tierLabels.${key}`, key)

  const pulseCheckActive = resolveFeatureFlag(companyFlags, 'pulseCheck')

  return (
    <Card
      title={t('planFeatures.title', { tier: tierLabel(tier) })}
      description={t('planFeatures.description')}
    >
      <div>
        {FEATURE_FLAG_KEYS.filter((key) => key !== 'pulseCheck').map((key) => (
          <FeatureRow
            key={key}
            flagKey={key}
            entry={FEATURE_FLAGS[key]}
            tier={tier}
            companyFlags={companyFlags}
            t={t}
            tierLabel={tierLabel}
          />
        ))}

        <div className="flex items-start justify-between gap-4 border-b border-line-soft py-3.5 last:border-b-0">
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
              {formatCurrency(pulseCheckAddOnPrice)}
              {t('billingQuote.perMonth')}
            </p>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted">
        {t('planFeatures.footnote', { tier: tierLabel(PLAN_TIER_ORDER[PLAN_TIER_ORDER.length - 1]) })}
      </p>
    </Card>
  )
}

export default PlanFeaturesCard
