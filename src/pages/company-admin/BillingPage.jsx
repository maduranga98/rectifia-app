import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { getCompany } from '../../services/companyService'
import { startBillingCheckout, openBillingPortal } from '../../services/billingService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { SkeletonStats } from '../../components/ui/Loading'
import BillingQuote from '../../components/dashboard/BillingQuote'
import PackageSelector from '../../components/dashboard/PackageSelector'
import PulseCheckToggle from '../../components/dashboard/PulseCheckToggle'

// A billing status is either fine or it isn't, and that difference should be
// visible before the word is read. Values are whatever Stripe's subscription
// status is (see functions/src/billing/stripeWebhook.js) - 'active' and
// 'trialing' are the two "everything is fine" states, 'past_due'/'canceled'/
// 'unpaid' the three "needs attention" ones, and anything else (Stripe's
// 'incomplete'/'incomplete_expired'/'paused', or 'unknown' for a company with
// no subscription at all) falls through to the neutral tone below.
const BILLING_TONE = {
  active: 'tone-low',
  trialing: 'tone-info',
  past_due: 'tone-critical',
  canceled: 'tone-critical',
  unpaid: 'tone-critical',
}

// Company Admin's billing home: subscription status, the "set up billing" /
// "manage billing" action, and the pricing engine (current tier, current
// price, bracket breakdown, plan feature lock display, what-if headcount
// calculator) in BillingQuote below it. Actually starting or changing
// billing always goes through Stripe - Checkout for the first subscription,
// the Stripe-hosted Billing Portal for payment method/invoices/cancellation
// afterward - never a form on this page; see src/services/billingService.js.
function BillingPage({ companyId }) {
  const { t } = useTranslation()
  const [company, setCompany] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState(null)
  const [actionPending, setActionPending] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setCompany(await getCompany(companyId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const billingStatus = company?.billingStatus ?? 'unknown'
  const checkoutResult = searchParams.get('checkout')

  function dismissCheckoutResult() {
    const next = new URLSearchParams(searchParams)
    next.delete('checkout')
    setSearchParams(next, { replace: true })
  }

  async function handleSetUpBilling() {
    setActionPending('checkout')
    setActionError(null)
    try {
      const { url } = await startBillingCheckout(companyId)
      window.location.href = url
    } catch (err) {
      setActionError(err.message)
      setActionPending(null)
    }
  }

  async function handleManageBilling() {
    setActionPending('portal')
    setActionError(null)
    try {
      const { url } = await openBillingPortal(companyId)
      window.location.href = url
    } catch (err) {
      setActionError(err.message)
      setActionPending(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {error && <Alert variant="error">{error}</Alert>}

      {checkoutResult === 'success' && (
        <Alert variant="success" title={t('billingPage.checkoutResult.success.title')}>
          {t('billingPage.checkoutResult.success.body')}{' '}
          <button type="button" className="underline" onClick={dismissCheckoutResult}>
            {t('billingPage.checkoutResult.dismiss')}
          </button>
        </Alert>
      )}
      {checkoutResult === 'cancelled' && (
        <Alert variant="info" title={t('billingPage.checkoutResult.cancelled.title')}>
          {t('billingPage.checkoutResult.cancelled.body')}{' '}
          <button type="button" className="underline" onClick={dismissCheckoutResult}>
            {t('billingPage.checkoutResult.dismiss')}
          </button>
        </Alert>
      )}
      {actionError && <Alert variant="error">{actionError}</Alert>}

      {loading && !company ? (
        <SkeletonStats count={2} />
      ) : (
        <>
          <Card padded={false} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  {t('billingPage.subscriptionStatus')}
                </p>
                {company?.name && <p className="mt-1 text-sm text-muted">{company.name}</p>}
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={BILLING_TONE[billingStatus] ?? 'tone-neutral'} dot>
                  {billingStatus.replace(/_/g, ' ')}
                </Badge>
                {company?.stripeSubscriptionId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={actionPending === 'portal'}
                    loadingLabel={t('billingPage.actions.openingPortal')}
                    onClick={handleManageBilling}
                  >
                    {t('billingPage.actions.manageBilling')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="accent"
                    loading={actionPending === 'checkout'}
                    loadingLabel={t('billingPage.actions.startingCheckout')}
                    onClick={handleSetUpBilling}
                  >
                    {t('billingPage.actions.setUpBilling')}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <BillingQuote companyId={companyId} />

          {/* Package selection & upgrade UI, driven by the company's
              declared employeeCount (see companyService.js's
              updateCompanyEmployeeCount comment and
              pricingEngine.js's readDeclaredEmployeeCount() for why that
              field, not the live roster, is authoritative for billing).
              PackageSelector/PulseCheckToggle write subscriptionTier/
              pulseCheckTier via upgradeSubscription.js, which now actually
              calls Stripe - see that function's file comment. */}
          <PackageSelector companyId={companyId} company={company} onChanged={refresh} />
          <PulseCheckToggle companyId={companyId} company={company} onChanged={refresh} />

          <Alert variant="info" title={t('billingPage.paymentNote.title')}>
            {t('billingPage.paymentNote.body')}
          </Alert>
        </>
      )}
    </div>
  )
}

export default BillingPage
