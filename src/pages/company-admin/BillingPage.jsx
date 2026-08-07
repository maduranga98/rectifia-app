import { useCallback, useEffect, useState } from 'react'
import { getCompany } from '../../services/companyService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import { SkeletonStats } from '../../components/ui/Loading'
import BillingQuote from '../../components/dashboard/BillingQuote'

// A billing status is either fine or it isn't, and that difference should be
// visible before the word is read.
const BILLING_TONE = {
  active: 'tone-low',
  trialing: 'tone-info',
  past_due: 'tone-critical',
  canceled: 'tone-critical',
  unpaid: 'tone-critical',
}

// Read-only status display only - no payment form, no Stripe/payment
// integration here. Plan changes and billing mutations happen outside this
// module, same as the original Company Admin panel note. The pricing engine
// itself (current tier, current price, bracket breakdown, what-if headcount
// calculator) lives in BillingQuote - this page just adds the subscription
// status chip around it.
function BillingPage({ companyId }) {
  const [company, setCompany] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      {error && <Alert variant="error">{error}</Alert>}

      {loading && !company ? (
        <SkeletonStats count={2} />
      ) : (
        <>
          <Card padded={false} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Subscription status
                </p>
                {company?.name && <p className="mt-1 text-sm text-muted">{company.name}</p>}
              </div>
              <Badge tone={BILLING_TONE[billingStatus] ?? 'tone-neutral'} dot className="mt-1">
                {billingStatus.replace(/_/g, ' ')}
              </Badge>
            </div>
          </Card>

          <BillingQuote companyId={companyId} />

          <Alert variant="info" title="Read-only">
            Payment details and plan changes are handled outside this panel. Contact Lumora to
            change your subscription.
          </Alert>
        </>
      )}
    </div>
  )
}

export default BillingPage
