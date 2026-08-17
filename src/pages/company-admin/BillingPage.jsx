import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCompany } from '../../services/companyService'
import { openBillingPortal, requestQuote } from '../../services/billingService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { SkeletonStats } from '../../components/ui/Loading'
import BillingQuote from '../../components/dashboard/BillingQuote'

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

// Company Admin's billing home. Pilot v1 has a handful of founding customers
// on individually negotiated discounts, no SOC 2 report or reference
// customers yet, and self-serve published-rate billing doesn't represent
// what any real customer actually pays - so this page is READ-ONLY plus one
// request action, never a place to start or change a subscription:
//
//  - Subscription status, as last set (manually, after negotiating a price)
//    on the company doc's billingStatus/subscriptionTier, or reconciled by
//    stripeWebhook.js once a subscription exists. There is no "Set up
//    billing" button anywhere on this page - a Company Admin cannot start a
//    subscription themselves. Actual subscription setup happens outside the
//    app: Lumora staff create the Stripe subscription by hand once sales has
//    negotiated a price, and set company.stripeSubscriptionId/billingStatus/
//    subscriptionTier directly, the same manual-write pattern the
//    billingHistory audit trail already uses elsewhere in this app.
//  - "Manage billing" (the Stripe-hosted Billing Portal) only once a
//    subscription already exists - this is still the right place for a
//    customer to see invoices or update a payment method after Lumora has
//    set one up.
//  - BillingQuote.jsx's reference pricing, clearly labeled as a reference
//    rate only (see that component's own framing) - never a price a company
//    can act on directly.
//  - A single "Request a quote" action (requestQuote.js), the only billing
//    action a Company Admin can take: it asks Rectifia's sales team for a
//    real, negotiated price and never creates or changes a subscription
//    itself.
function BillingPage({ companyId }) {
  const { t } = useTranslation()
  const [company, setCompany] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState(null)
  const [actionPending, setActionPending] = useState(false)
  const [quoteRequested, setQuoteRequested] = useState(false)

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

  async function handleManageBilling() {
    setActionPending(true)
    setActionError(null)
    try {
      const { url } = await openBillingPortal(companyId)
      window.location.href = url
    } catch (err) {
      setActionError(err.message)
      setActionPending(false)
    }
  }

  // Files a real quote request for both the Core plan and the Pulse Check
  // add-on in one click - requestQuote.js only ever takes one `target` per
  // call, but a Company Admin only sees a single button here (see this
  // page's requirement to never expose a self-serve plan/add-on picker), so
  // both requests are filed together so Lumora's sales follow-up has the
  // full picture from one click.
  async function handleRequestQuote() {
    setActionPending(true)
    setActionError(null)
    try {
      await Promise.all([
        requestQuote(companyId, { target: 'core' }),
        requestQuote(companyId, { target: 'pulseCheck' }),
      ])
      setQuoteRequested(true)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionPending(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {error && <Alert variant="error">{error}</Alert>}
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
                {company?.stripeSubscriptionId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={actionPending}
                    loadingLabel={t('billingPage.actions.openingPortal')}
                    onClick={handleManageBilling}
                  >
                    {t('billingPage.actions.manageBilling')}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <BillingQuote companyId={companyId} />

          <Card padded={false} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-charcoal">{t('billingPage.requestQuote.title')}</p>
                <p className="mt-1 text-xs text-muted">{t('billingPage.requestQuote.body')}</p>
              </div>
              {quoteRequested ? (
                <Alert variant="success" className="grow-0">
                  {t('billingPage.requestQuote.requested')}
                </Alert>
              ) : (
                <Button
                  variant="accent"
                  loading={actionPending}
                  loadingLabel={t('billingPage.actions.requestingQuote')}
                  onClick={handleRequestQuote}
                >
                  {t('billingPage.actions.requestQuote')}
                </Button>
              )}
            </div>
          </Card>

          <Alert variant="info" title={t('billingPage.paymentNote.title')}>
            {t('billingPage.paymentNote.body')}
          </Alert>
        </>
      )}
    </div>
  )
}

export default BillingPage
