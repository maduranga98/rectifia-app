import { useCallback, useEffect, useState } from 'react'
import { getCompanyBillingSummary, listCompanyPaymentHistory } from '../../services/superAdminBillingService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import { SkeletonList, SkeletonStats } from '../ui/Loading'
import CompanyBillingLink from './CompanyBillingLink'

const STATUS_TONE = {
  active: 'tone-low',
  trialing: 'tone-info',
  past_due: 'tone-critical',
  canceled: 'tone-critical',
  unpaid: 'tone-critical',
  unbilled: 'tone-neutral',
}

const INVOICE_STATUS_TONE = {
  paid: 'tone-low',
  open: 'tone-info',
  uncollectible: 'tone-critical',
  void: 'tone-neutral',
  draft: 'tone-neutral',
}

function statusLabel(status) {
  if (!status || status === 'unbilled') return 'Not yet billed'
  return status.replace(/_/g, ' ')
}

function formatCurrencyFromCents(cents, currency) {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

function formatDate(unixSeconds) {
  if (unixSeconds == null) return '—'
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

function EmployeeCountLine({ employeeCount, employeeCountSource }) {
  if (employeeCount == null) {
    return <p className="text-sm text-muted">No employee count on file.</p>
  }
  const sourceLabel = employeeCountSource === 'roster' ? 'from roster' : 'declared estimate'
  return (
    <p className="text-sm text-charcoal">
      <span className="font-medium tabular-nums">{employeeCount.toLocaleString()}</span>{' '}
      <span className="text-muted">employees ({sourceLabel})</span>
    </p>
  )
}

function PaymentHistoryTable({ invoices }) {
  if (invoices.length === 0) {
    return <p className="text-sm text-muted">No invoices yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line-soft text-xs uppercase tracking-[0.06em] text-muted">
            <th className="py-2 pr-3 font-semibold">Date</th>
            <th className="py-2 pr-3 font-semibold">Amount</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 pr-3 font-semibold">Invoice</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="border-b border-line-soft last:border-b-0">
              <td className="py-2 pr-3 text-charcoal">{formatDate(invoice.created)}</td>
              <td className="py-2 pr-3 tabular-nums text-charcoal">
                {formatCurrencyFromCents(invoice.amountPaidCents, invoice.currency)}
              </td>
              <td className="py-2 pr-3">
                <Badge tone={INVOICE_STATUS_TONE[invoice.status] ?? 'tone-neutral'} dot>
                  {invoice.status}
                </Badge>
              </td>
              <td className="py-2 pr-3">
                {invoice.hostedInvoiceUrl ? (
                  <a
                    href={invoice.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-navy hover:underline"
                  >
                    {invoice.number ?? 'View'}
                  </a>
                ) : (
                  <span className="text-muted">{invoice.number ?? '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Super Admin's read-only billing panel for a single company - the default
// content behind the "Billing" toggle on SuperAdminDashboardPage, replacing
// what used to be CompanyBillingLink.jsx shown bare. Both live Stripe reads
// (getCompanyBillingSummary/listCompanyPaymentHistory) are fetched fresh on
// every open, never cached on the company doc, same convention as the
// Company-Admin-facing BillingQuote.jsx/getSubscriptionSummary.js pair.
//
// CompanyBillingLink.jsx - the only recovery path for a missed webhook -
// is not gone, just demoted: it now lives under a collapsed "Manual link"
// disclosure at the bottom of this same panel instead of being the whole
// panel.
function CompanyBillingSummary({ company, onLinked }) {
  const [summary, setSummary] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showManualLink, setShowManualLink] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [summaryResult, historyResult] = await Promise.all([
        getCompanyBillingSummary(company.id),
        listCompanyPaymentHistory(company.id),
      ])
      setSummary(summaryResult)
      setInvoices(historyResult.invoices)
    } catch (err) {
      setError(err.message || 'Could not load billing summary')
    } finally {
      setLoading(false)
    }
  }, [company.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleLinked() {
    await Promise.all([refresh(), onLinked?.()])
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert variant="error">{error}</Alert>}

      {loading && !summary ? (
        <SkeletonStats count={2} />
      ) : (
        summary && (
          <div className="rounded-lg border border-line-soft p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Subscription status</p>
                <div className="mt-1">
                  <Badge tone={STATUS_TONE[summary.status] ?? 'tone-neutral'} dot>
                    {statusLabel(summary.status)}
                  </Badge>
                </div>
              </div>
              {summary.billed && (
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Monthly charge</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-charcoal">
                    {formatCurrencyFromCents(summary.totalPriceCents, summary.currency)}
                    <span className="text-sm font-normal text-muted"> / month</span>
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 border-t border-line-soft pt-3">
              <EmployeeCountLine
                employeeCount={summary.employeeCount}
                employeeCountSource={summary.employeeCountSource}
              />
            </div>

            {summary.billed && (
              <div className="mt-3 flex flex-col gap-1 border-t border-line-soft pt-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Core</span>
                  <span className="tabular-nums text-charcoal">
                    {formatCurrencyFromCents(summary.corePriceCents, summary.currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Pulse Check</span>
                  <span className="tabular-nums text-charcoal">
                    {summary.pulseCheckPriceCents != null
                      ? formatCurrencyFromCents(summary.pulseCheckPriceCents, summary.currency)
                      : 'Not purchased'}
                  </span>
                </div>
                {summary.currentPeriodEnd != null && (
                  <p className="mt-1 text-xs text-muted">Renews {formatDate(summary.currentPeriodEnd)}</p>
                )}
              </div>
            )}
          </div>
        )
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">Payment history</p>
        {loading && invoices.length === 0 ? <SkeletonList rows={2} /> : <PaymentHistoryTable invoices={invoices} />}
      </div>

      <div className="border-t border-line-soft pt-3">
        <Button size="sm" variant="ghost" onClick={() => setShowManualLink((open) => !open)}>
          {showManualLink ? 'Hide manual link' : 'Manual link (missed webhook)'}
        </Button>
        {showManualLink && (
          <div className="mt-3">
            <CompanyBillingLink company={company} onLinked={handleLinked} />
          </div>
        )}
      </div>
    </div>
  )
}

export default CompanyBillingSummary
