import { useEffect, useState } from 'react'
import { getCompany, updateCompanyFeatureFlag } from '../../services/companyService'
import { FEATURE_FLAG_KEYS, FEATURE_FLAGS, hasExplicitFeatureFlag, resolveFeatureFlag } from '../../config/featureFlags'
import { lowestTierForFeature } from '../../config/pricingConfig'
import Alert from '../ui/Alert'
import Card from '../ui/Card'
import { Select } from '../ui/Field'
import { SkeletonList } from '../ui/Loading'

const TIER_LABELS = { starter: 'Starter', growth: 'Growth', scale: 'Scale', enterprise: 'Enterprise' }

// Which plan tier normally includes this flag, purely from the static
// PLAN_FEATURES ladder in pricingConfig.js - not this specific company's
// actual billing tier. Deliberately not a live per-company lookup: the
// callable that computes a company's real tier (calculateQuote) is scoped to
// that company's own Company Admin / billingView staff and rejects a Super
// Admin's token, so this panel has no server-authorized way to ask "what
// tier is company X on" for an arbitrary company anyway. This badge is
// guidance ("this is normally a Growth-and-up feature") for whoever is about
// to toggle the switch below, not an enforcement of that company's plan.
function planBadge(flagKey) {
  if (flagKey === 'pulseCheck') {
    return { text: 'Add-on (billed separately, any tier)', className: 'bg-navy-100 text-navy' }
  }
  const tier = lowestTierForFeature(flagKey)
  return tier
    ? { text: `Included from: ${TIER_LABELS[tier]}`, className: 'bg-line-soft text-muted' }
    : { text: 'Not in any plan tier', className: 'bg-line-soft text-muted' }
}

// One flag row: label, description, the resolved effective value, and
// whether that value is an explicit override or just the registry default
// showing through. The switch itself is a styled checkbox rather than a new
// UI primitive - this is the only place in the app that needs one.
function FlagRow({ flagKey, entry, companyFlags, disabled, onToggle }) {
  const enabled = resolveFeatureFlag(companyFlags, flagKey)
  const isOverride = hasExplicitFeatureFlag(companyFlags, flagKey)
  const plan = planBadge(flagKey)

  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-charcoal">{entry.label}</p>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              isOverride ? 'bg-navy-100 text-navy' : 'bg-line-soft text-muted'
            }`}
          >
            {isOverride ? 'Override' : `Default (${entry.default ? 'on' : 'off'})`}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${plan.className}`}>{plan.text}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{entry.description}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${entry.label}: ${enabled ? 'on' : 'off'}`}
        disabled={disabled}
        onClick={() => onToggle(flagKey, !enabled)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          enabled ? 'bg-navy' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-card transition-transform ${
            enabled ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

// Super Admin-only company selector plus a toggle per registry flag. Writes
// go through updateCompanyFeatureFlag (a single-field dot-path update), and
// firestore.rules is what actually keeps a non-Super-Admin from ever
// reaching this write - the role gate a caller of this component applies
// (see SuperAdminDashboardPage.jsx, reachable only from a route already
// behind requireSuperAdmin) is the UX layer in front of that, not the
// enforcement itself.
//
// Turning a flag off never touches any data this company has already
// produced under it - this panel only ever writes the one boolean.
function FeatureFlagPanel({ companies }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const [companyFlags, setCompanyFlags] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [savingKey, setSavingKey] = useState(null)

  useEffect(() => {
    // No company selected (an empty companies list) - companyFlags' initial
    // state is already null, nothing to do.
    if (!companyId) return undefined

    let cancelled = false
    setLoading(true)
    setError(null)
    getCompany(companyId)
      .then((company) => {
        if (!cancelled) setCompanyFlags(company?.featureFlags ?? null)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load this company\'s feature flags')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  async function handleToggle(key, value) {
    setSavingKey(key)
    setError(null)
    try {
      await updateCompanyFeatureFlag(companyId, key, value)
      setCompanyFlags((prev) => ({ ...prev, [key]: value }))
    } catch (err) {
      setError(err.message || `Could not update ${FEATURE_FLAGS[key]?.label ?? key}`)
    } finally {
      setSavingKey(null)
    }
  }

  if (companies.length === 0) {
    return (
      <Card title="Feature flags">
        <p className="text-sm text-muted">Register a company before configuring its feature flags.</p>
      </Card>
    )
  }

  return (
    <Card
      title="Feature flags"
      description="Per-company kill switches. Turning a flag off stops new use of that module; it never deletes or hides data already produced under it."
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </Select>

        {error && <Alert variant="error">{error}</Alert>}

        {loading ? (
          <SkeletonList rows={FEATURE_FLAG_KEYS.length} />
        ) : (
          <div>
            {FEATURE_FLAG_KEYS.map((key) => (
              <FlagRow
                key={key}
                flagKey={key}
                entry={FEATURE_FLAGS[key]}
                companyFlags={companyFlags}
                disabled={savingKey === key}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

export default FeatureFlagPanel
