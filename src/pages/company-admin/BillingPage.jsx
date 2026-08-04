import { useCallback, useEffect, useState } from 'react'
import { getCompany } from '../../services/companyService'
import { listStaff } from '../../services/routingService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Card from '../../components/ui/Card'
import StatTile from '../../components/ui/StatTile'
import { SkeletonStats } from '../../components/ui/Loading'

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
// module, same as the original Company Admin panel note.
function BillingPage({ companyId }) {
  const [company, setCompany] = useState(null)
  const [employeeCount, setEmployeeCount] = useState(0)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [companyData, staffRows] = await Promise.all([getCompany(companyId), listStaff(companyId)])
      setCompany(companyData)
      setEmployeeCount(staffRows.filter((s) => (s.status ?? 'active') !== 'suspended').length)
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
        <SkeletonStats count={3} />
      ) : (
        <>
          <Card padded={false} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  Current plan
                </p>
                <p className="mt-1 text-2xl font-semibold capitalize text-charcoal">
                  {company?.subscriptionTier ?? 'Not set'}
                </p>
                {company?.name && <p className="mt-1 text-sm text-muted">{company.name}</p>}
              </div>
              <Badge tone={BILLING_TONE[billingStatus] ?? 'tone-neutral'} dot className="mt-1">
                {billingStatus.replace(/_/g, ' ')}
              </Badge>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StatTile
              label="Cases this period"
              value={company?.currentPeriodCaseCount ?? 0}
              tone="tone-info"
              icon="cases"
            />
            <StatTile label="Active staff" value={employeeCount} tone="tone-neutral" icon="staff" />
          </div>

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
