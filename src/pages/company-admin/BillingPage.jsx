import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { getCompany } from '../../services/companyService'
import {
  getCompanyQuote,
  openBillingPortal,
  requestQuote,
  syncCheckoutSession,
} from '../../services/billingService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { SkeletonStats } from '../../components/ui/Loading'
import BillingQuote from '../../components/dashboard/BillingQuote'
import { MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES } from '../../config/pricingConfig'

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

// Stripe hands a paying Company Admin straight back to
// /admin/billing?checkout=success (createCheckoutSession.js sets that
// success_url), which routinely happens BEFORE stripeWebhook.js has been
// delivered the checkout.session.completed event that writes the
// subscription onto the company doc. Re-reading the company doc on that
// return is therefore not enough on its own - it reads the pre-checkout
// state and the page shows the subscriber the same "Subscribe" card they
// just paid on, as if nothing happened. So the return leg calls
// syncCheckoutSession() (which reconciles the company doc from Stripe
// directly, exactly as the webhook would) and retries on this schedule
// while Stripe is still creating the subscription: ~18s total, spread out
// rather than hammered, since the usual case resolves on the first attempt.
const CHECKOUT_SYNC_RETRY_DELAYS_MS = [0, 2000, 3000, 5000, 8000]

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

// Company Admin's billing home. Self-serve subscribe (via BillingQuote.jsx's
// SubscribeCard) is now the primary path for most companies - this page is
// no longer read-only plus one request action; the request-a-quote flow
// below is the fallback for whoever BillingQuote.jsx doesn't offer
// self-serve to. Pilot v1 has a handful of founding customers on
// individually negotiated discounts, no SOC 2 report or reference customers
// yet, and self-serve published-rate billing doesn't represent what any
// real customer actually pays for those legacy accounts:
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
  const [searchParams, setSearchParams] = useSearchParams()
  const checkoutOutcome = searchParams.get('checkout')
  // 'syncing' | 'confirmed' | 'pending' | 'cancelled' | null - the return
  // leg of self-serve checkout, see CHECKOUT_SYNC_RETRY_DELAYS_MS above.
  // Seeded from the landing URL rather than set from inside the effect
  // below: the banner must be on screen for the subscriber's very first
  // paint after Stripe redirects them back, not one render later.
  const [checkoutState, setCheckoutState] = useState(() => {
    if (checkoutOutcome === 'success') return 'syncing'
    if (checkoutOutcome === 'cancelled') return 'cancelled'
    return null
  })
  // Bumped once the subscription lands so BillingQuote re-reads too - it
  // keeps its own copy of the company doc and would otherwise go on
  // rendering its SubscribeCard until the next full page load.
  const [reloadToken, setReloadToken] = useState(0)
  const checkoutHandledRef = useRef(false)

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

  // One attempt at reconciling the company doc with Stripe. Returns true
  // once a subscription exists (and reloads everything this page and
  // BillingQuote render from it), false while Stripe hasn't produced one
  // yet. Throws only on a real call failure.
  const attemptCheckoutSync = useCallback(async () => {
    const result = await syncCheckoutSession(companyId)
    if (!result?.synced) return false
    setReloadToken((token) => token + 1)
    await refresh()
    return true
  }, [companyId, refresh])

  useEffect(() => {
    // Guarded by a ref, not by the query param: the param is cleared once
    // this resolves (below), which re-runs this effect, and re-running the
    // retry loop from a URL change would double up the calls.
    if (!companyId || !checkoutOutcome || checkoutHandledRef.current) return
    checkoutHandledRef.current = true

    if (checkoutOutcome !== 'success') {
      // 'cancelled' (createCheckoutSession.js's cancel_url) or anything
      // unrecognised: nothing was charged and nothing needs reconciling -
      // the banner, if any, is already seeded above.
      setSearchParams({}, { replace: true })
      return
    }

    let abandoned = false
    ;(async () => {
      for (const waitMs of CHECKOUT_SYNC_RETRY_DELAYS_MS) {
        if (waitMs) await delay(waitMs)
        if (abandoned) return
        try {
          if (await attemptCheckoutSync()) {
            if (!abandoned) setCheckoutState('confirmed')
            return
          }
        } catch (err) {
          // A failing sync call is worth surfacing rather than retrying
          // silently - the payment itself already went through, so the
          // subscriber needs to know the app couldn't confirm it yet.
          if (!abandoned) {
            setActionError(err.message)
            setCheckoutState('pending')
          }
          return
        }
      }
      // Stripe accepted the payment but hasn't produced a subscription
      // within the retry window. The webhook will still land; the manual
      // re-check below is what turns that into something the subscriber can
      // act on instead of a page that looks unchanged.
      if (!abandoned) setCheckoutState('pending')
    })().finally(() => {
      if (!abandoned) setSearchParams({}, { replace: true })
    })

    return () => {
      abandoned = true
    }
  }, [companyId, checkoutOutcome, attemptCheckoutSync, setSearchParams])

  async function handleCheckAgain() {
    setActionPending(true)
    setActionError(null)
    try {
      setCheckoutState((await attemptCheckoutSync()) ? 'confirmed' : 'pending')
    } catch (err) {
      setActionError(err.message)
    } finally {
      setActionPending(false)
    }
  }

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
  // Mirrors BillingQuote.jsx's own self-serve gate (same realHeadcount count,
  // via getCompanyQuote's employeeCount here) so the request-a-quote card
  // below only shows when BillingQuote.jsx genuinely didn't render a
  // Subscribe card - no roster/declared-count quote yet, or above the
  // self-serve ceiling.
  const selfServeAvailable = hasQuote && employeeCount <= MANUAL_SALES_REVIEW_THRESHOLD_EMPLOYEES

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {error && <Alert variant="error">{error}</Alert>}
      {actionError && <Alert variant="error">{actionError}</Alert>}

      {checkoutState === 'syncing' && (
        <Alert variant="info" title={t('billingPage.checkout.syncing.title')}>
          {t('billingPage.checkout.syncing.body')}
        </Alert>
      )}

      {checkoutState === 'confirmed' && (
        <Alert variant="success" title={t('billingPage.checkout.confirmed.title')}>
          {t('billingPage.checkout.confirmed.body')}
        </Alert>
      )}

      {checkoutState === 'pending' && (
        <Alert variant="warning" title={t('billingPage.checkout.pending.title')}>
          <div className="flex flex-col items-start gap-3">
            <p>{t('billingPage.checkout.pending.body')}</p>
            <Button
              size="sm"
              variant="secondary"
              loading={actionPending}
              loadingLabel={t('billingPage.checkout.checking')}
              onClick={handleCheckAgain}
            >
              {t('billingPage.checkout.checkAgain')}
            </Button>
          </div>
        </Alert>
      )}

      {checkoutState === 'cancelled' && (
        <Alert variant="info" title={t('billingPage.checkout.cancelled.title')}>
          {t('billingPage.checkout.cancelled.body')}
        </Alert>
      )}

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

          <BillingQuote companyId={companyId} reloadToken={reloadToken} />

          {!hasStripeSubscription && !selfServeAvailable && (
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
