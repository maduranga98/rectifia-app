import { useState } from 'react'
import { SUBSCRIPTION_TIERS } from '../../services/companyService'
import { linkCompanySubscription } from '../../services/superAdminBillingService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import { Input, Select } from '../ui/Field'

const TIER_LABELS = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' }

const BILLING_TONE = {
  active: 'tone-low',
  trialing: 'tone-info',
  past_due: 'tone-critical',
  canceled: 'tone-critical',
  unpaid: 'tone-critical',
}

function billingStatusLabel(status) {
  if (!status || status === 'unbilled') return 'Not yet billed'
  return status.replace(/_/g, ' ')
}

// Super Admin's real billing-linking tool, replacing the fake billingStatus/
// subscriptionTier a company used to be created with. A company now starts
// out genuinely unbilled (see companyService.js's createCompany) and this
// panel is the only client-reachable way to change that: paste the Stripe
// Subscription ID of a subscription a human already created - through an
// accepted Quote or set up directly in the Stripe Dashboard - pick the plan
// tier that was actually negotiated, and submit. Calling this again for the
// same company (a new Subscription ID, or the same one after a Dashboard
// edit) is also how a plan change or add-on change gets re-synced; there is
// no separate upgrade/downgrade action.
//
// firestore.rules' superAdminBillingFieldsLocked() means none of the fields
// this shows can be written directly, by this panel or any other client
// path - the linkCompanySubscription callable (Admin SDK) is the only writer
// besides stripeWebhook.js itself.
function CompanyBillingLink({ company, onLinked }) {
  const [stripeSubscriptionId, setStripeSubscriptionId] = useState('')
  const [subscriptionTier, setSubscriptionTier] = useState(SUBSCRIPTION_TIERS[0])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const hasSubscription = Boolean(company?.stripeSubscriptionId)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const result = await linkCompanySubscription({
        companyId: company.id,
        stripeSubscriptionId: stripeSubscriptionId.trim(),
        subscriptionTier,
      })
      setSuccess(`Linked. Status: ${billingStatusLabel(result.billingStatus)}, tier: ${TIER_LABELS[result.subscriptionTier] ?? result.subscriptionTier}.`)
      setStripeSubscriptionId('')
      await onLinked?.()
    } catch (err) {
      // Surface the callable's own message directly - it names the specific
      // untagged line item or the conflicting company by name, and a
      // generic "failed" message would throw that detail away.
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line-soft px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Current billing</p>
          <p className="mt-1 text-sm text-charcoal">
            {hasSubscription ? (
              <>
                {company.subscriptionTier ? (TIER_LABELS[company.subscriptionTier] ?? company.subscriptionTier) : 'Tier not set'}
                {' - '}
                <span className="font-mono text-xs text-muted">{company.stripeSubscriptionId}</span>
              </>
            ) : (
              'Not yet billed'
            )}
          </p>
        </div>
        <Badge tone={BILLING_TONE[company?.billingStatus] ?? 'tone-neutral'} dot>
          {billingStatusLabel(company?.billingStatus)}
        </Badge>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Stripe Subscription ID"
          type="text"
          value={stripeSubscriptionId}
          onChange={(e) => setStripeSubscriptionId(e.target.value)}
          required
          placeholder="sub_..."
          hint={
            hasSubscription
              ? 'Re-linking re-syncs status and items from Stripe and re-labels the tier - use this after a plan or add-on change.'
              : 'Paste the ID of a subscription already created for this company - via an accepted Quote or directly in the Stripe Dashboard. This never creates a new subscription.'
          }
        />
        <Select
          label="Subscription tier"
          value={subscriptionTier}
          onChange={(e) => setSubscriptionTier(e.target.value)}
        >
          {SUBSCRIPTION_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {TIER_LABELS[tier] ?? tier}
            </option>
          ))}
        </Select>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <div>
          <Button
            type="submit"
            variant="accent"
            loading={submitting}
            loadingLabel="Linking..."
            disabled={!stripeSubscriptionId.trim()}
          >
            {hasSubscription ? 'Re-link / update' : 'Link subscription'}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default CompanyBillingLink
