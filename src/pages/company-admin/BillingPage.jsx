import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCompany } from '../../services/companyService'
import { getCompanyQuote, openBillingPortal, requestQuote } from '../../services/billingService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { SkeletonStats } from '../../components/ui/Loading'
import BillingQuote from '../../components/dashboard/BillingQuote'

function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

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

// billingStatus values that mean "money is (or was) actively changing
// hands", per stripeWebhook.js. 'canceled' is deliberately excluded: the
// webhook legitimately deletes stripeSubscriptionId while setting
// billingStatus to 'canceled' (handleSubscriptionDeleted), so that
// combination is expected, not a data-integrity problem - only the four
// statuses below should ever co-occur with a live stripeSubscriptionId.
const PAYING_BILLING_STATUSES = ['active', 'trialing', 'past_due', 'unpaid']

// 'unbilled' means "genuinely has no subscription yet" - the status a
// company is created with now (see companyService.js's createCompany),
// distinct from 'unknown' ("we don't know") and from every
// PAYING_BILLING_STATUSES value, so it never trips
// hasDataIntegrityWarning below. Falls through to BILLING_TONE's neutral
// default (no entry needed there) but gets its own readable label here
// rather than the raw underscore-replaced status string.
function billingStatusLabel(t, status) {
  if (status === 'unbilled') return t('billingPage.statusLabels.unbilled')
  return status.replace(/_/g, ' ')
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
//  - BillingQuote.jsx's reference pricing - shown for a prospect only (no
//    stripeSubscriptionId yet), clearly labeled as a reference rate only
//    (see that component's own framing) and never a price a company can act
//    on directly. Once stripeSubscriptionId exists, BillingQuote.jsx
//    switches to showing the current plan/tier instead of the reference
//    quote flow.
//  - A single "Request a quote" action (requestQuote.js) - shown only for a
//    prospect (no stripeSubscriptionId yet), same gate as the reference
//    pricing above. It's the only billing action a Company Admin can take:
//    it asks Rectifia's sales team for a real, negotiated price and never
//    creates or changes a subscription itself.
function BillingPage({ companyId }) {
  const { t } = useTranslation()
  const [company, setCompany] = useState(null)
  const [quote, setQuote] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState(null)
  const [actionPending, setActionPending] = useState(false)
  const [quoteRequested, setQuoteRequested] = useState(false)
  const [includePulseCheck, setIncludePulseCheck] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [companyDoc, quoteResult] = await Promise.all([getCompany(companyId), getCompanyQuote(companyId)])
      setCompany(companyDoc)
      setQuote(quoteResult)
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
  // The single source of truth for "is this an active paying customer" -
  // see the module comment on stripeWebhook.js's applySubscriptionState().
  // billingStatus alone is never trusted for this: it's the value most
  // likely to be set by hand ahead of (or without) the matching Stripe
  // subscription actually existing.
  const hasStripeSubscription = Boolean(company?.stripeSubscriptionId)
  // Only reachable via a manual data-entry mistake (see PAYING_BILLING_STATUSES
  // above) - flagged visibly rather than silently falling through to the
  // prospect flow below, which is what would otherwise happen since routing
  // here follows hasStripeSubscription, not billingStatus.
  const hasDataIntegrityWarning = !hasStripeSubscription && PAYING_BILLING_STATUSES.includes(billingStatus)

  useEffect(() => {
    if (hasDataIntegrityWarning) {
      console.error(
        `BillingPage: company ${companyId} has billingStatus "${billingStatus}" but no stripeSubscriptionId - likely a manual data-entry error`
      )
    }
  }, [hasDataIntegrityWarning, companyId, billingStatus])

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

  // Files a real quote request covering both the Core plan and the Pulse
  // Check add-on in one click - requestQuote.js defaults to both targets and
  // builds a single Stripe Quote with one line item each, so a Company
  // Admin (who only ever sees this single button, never a self-serve
  // plan/add-on picker) gets one Quote whose acceptance produces one
  // subscription.
  async function handleRequestQuote() {
    setActionPending(true)
    setActionError(null)
    try {
      await requestQuote(companyId, { targets: includePulseCheck ? ['core', 'pulseCheck'] : ['core'] })
      setQuoteRequested(true)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionPending(false)
    }
  }

  const hasQuote = Boolean(quote?.quote)
  const pulseCheckAddOnPrice = quote?.pulseCheckAddOnPrice ?? null
  const employeeCount = quote?.employeeCount ?? 0

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {error && <Alert variant="error">{error}</Alert>}
      {actionError && <Alert variant="error">{actionError}</Alert>}

      {loading && !company ? (
        <SkeletonStats count={2} />
      ) : (
        <>
          {hasDataIntegrityWarning && (
            <Alert variant="error" title={t('billingPage.dataIntegrityWarning.title')}>
              {t('billingPage.dataIntegrityWarning.body', { billingStatus: billingStatus.replace(/_/g, ' ') })}
            </Alert>
          )}

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
                  {billingStatusLabel(t, billingStatus)}
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

          {!hasStripeSubscription && (
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
                  <div className="flex flex-col items-end gap-2">
                    {hasQuote && (
                      <label className="flex items-center gap-2 text-sm text-charcoal">
                        <input
                          type="checkbox"
                          checked={includePulseCheck}
                          onChange={(e) => setIncludePulseCheck(e.target.checked)}
                        />
                        {t('billingPage.requestQuote.includePulseCheck', {
                          price: formatCurrency(pulseCheckAddOnPrice),
                          count: employeeCount,
                        })}
                      </label>
                    )}
                    <Button
                      variant="accent"
                      loading={actionPending}
                      loadingLabel={t('billingPage.actions.requestingQuote')}
                      onClick={handleRequestQuote}
                    >
                      {t('billingPage.actions.requestQuote')}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Alert variant="info" title={t('billingPage.paymentNote.title')}>
            {t('billingPage.paymentNote.body')}
          </Alert>
        </>
      )}
    </div>
  )
}

export default BillingPage
