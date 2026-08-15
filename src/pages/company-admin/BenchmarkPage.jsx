import { useCallback, useEffect, useState } from 'react'
import {
  INDUSTRY_LABELS,
  getBenchmarkCatalog,
  getBenchmarksForCompany,
  setBenchmarkOptIn,
} from '../../services/benchmarkService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Input, Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

// The plain, complete statement of what leaves this company's boundary and
// what never does. Rendered verbatim on the opt-in gate, and any change here
// is a change to the consent the acknowledgement flag records - it is not
// marketing copy.
function SharedDataDisclosure() {
  return (
    <div className="flex flex-col gap-4 text-sm text-charcoal">
      <div>
        <p className="font-semibold">What leaves your company when you opt in:</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>The category of each closed case (harassment, toxic management, retaliation, burnout).</li>
          <li>The two numeric scores on each closed case (severity, evidence).</li>
          <li>The coarse tier of the department the report was about (junior / senior / manager / unspecified) - never the department name.</li>
          <li>The action category taken at closure (a fixed list, from "no action" to "termination").</li>
          <li>The date the case was closed.</li>
          <li>Your industry and your employee-count band.</li>
        </ul>
      </div>
      <div>
        <p className="font-semibold">What never leaves your company:</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>Any narrative, any questionnaire answer, any evidence file.</li>
          <li>Any name - of a reporter, a witness, or anyone a report was about.</li>
          <li>Any identity, at any tier, in any form.</li>
          <li>Any Case ID.</li>
          <li>Any department name, any manager name, any job title.</li>
          <li>
            Your company's own identity in any published figure. Cells publish medians and rounded
            distributions over at least 5 companies and 25 cases; below either threshold nothing is
            published at all.
          </li>
        </ul>
      </div>
      <div>
        <p className="font-semibold">What withdrawing does:</p>
        <p className="mt-1.5">
          Your data is removed from all published figures at the next monthly recomputation. The
          pool is computed from scratch each run, not accumulated - your contribution does not
          linger in a running total.
        </p>
      </div>
    </div>
  )
}

function OptInStatusBadge({ optedIn }) {
  if (optedIn) return <Badge tone="tone-low" dot>Opted in</Badge>
  return <Badge tone="tone-neutral" dot>Not opted in</Badge>
}

// The Company Admin's opt-in control for Module 25. This page never renders
// the pool's numbers - that is the HR Coordinator's dashboard. Here it is
// consent, industry+headcount declaration, and withdrawal.
function BenchmarkPage({ companyId }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const [status, setStatus] = useState(null)
  const [catalog, setCatalog] = useState(null)

  // Form state - the industry and headcount to declare on opt-in, and the
  // required acknowledgement checkbox. All three start empty every load, so
  // no stale draft survives from a previous session.
  const [industry, setIndustry] = useState('')
  const [employeeCount, setEmployeeCount] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statusData, catalogData] = await Promise.all([
        getBenchmarksForCompany(),
        getBenchmarkCatalog(),
      ])
      setStatus(statusData)
      setCatalog(catalogData)
      if (statusData?.industry) setIndustry(statusData.industry)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  async function handleOptIn() {
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const parsed = Number.parseInt(employeeCount, 10)
      await setBenchmarkOptIn({
        optedIn: true,
        industry,
        employeeCount: parsed,
        acknowledged: true,
      })
      setAcknowledged(false)
      await refresh()
      setNotice(
        'Opted in. Your published cells will populate at the next monthly recompute - the first one may run within a few minutes.'
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleWithdraw() {
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      await setBenchmarkOptIn({
        optedIn: false,
        acknowledged: true,
      })
      setConfirmWithdraw(false)
      setAcknowledged(false)
      await refresh()
      setNotice(
        'Withdrawn. Your data will be removed from published figures at the next monthly recomputation.'
      )
    } catch (err) {
      setConfirmWithdraw(false)
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !status) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <SkeletonList rows={4} />
      </div>
    )
  }

  const optedIn = status?.optedIn === true
  const parsedCount = Number.parseInt(employeeCount, 10)
  const canOptIn =
    !optedIn &&
    catalog?.industries?.includes(industry) &&
    Number.isFinite(parsedCount) &&
    parsedCount >= 1 &&
    acknowledged

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        The cross-company benchmark pool lets you see whether the shape of your closed cases is
        typical for your industry and headcount band, or an outlier. It is aggregate statistics
        only - never raw case data, never your company's identity, and cells below the anonymity
        thresholds are not published at all.
      </p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card
        title="Your participation"
        description="Reading the pool requires contributing to it. A pool that can be read without contributing collapses into a one-way intelligence product, so both directions of participation are tied together."
      >
        <div className="flex flex-wrap items-center gap-3">
          <OptInStatusBadge optedIn={optedIn} />
          {optedIn && status?.industry && (
            <span className="text-sm text-muted">
              Contributing as{' '}
              <strong className="text-charcoal">
                {INDUSTRY_LABELS[status.industry] ?? status.industry}
              </strong>{' '}
              in size band{' '}
              <strong className="text-charcoal">{status.sizeBand ?? '-'}</strong>.
            </span>
          )}
          {optedIn && status?.incomplete && (
            <Alert variant="warning">
              Your industry or employee count no longer places your company inside a valid cell.
              Opt out and back in with an updated employee count to resume contributing and
              reading.
            </Alert>
          )}
        </div>
      </Card>

      <Card
        title="What is and is not shared"
        description="Read this before opting in or out. The acknowledgement below records that you have."
      >
        <SharedDataDisclosure />
      </Card>

      {optedIn ? (
        <Card
          title="Withdraw"
          description="Withdrawing takes effect at the next monthly recompute. Your contribution is removed completely - the pool is computed from scratch, not accumulated, so withdrawal is honest."
          footer={
            <div className="flex items-center gap-3">
              <Button
                variant="danger"
                onClick={() => setConfirmWithdraw(true)}
                disabled={submitting}
              >
                Withdraw from the benchmark pool
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted">
            After withdrawal your dashboard will no longer show benchmark comparisons, because
            reading requires contributing. You can opt back in at any time.
          </p>
        </Card>
      ) : (
        <Card
          title="Opt in"
          description="Declare your industry and current employee count, acknowledge what is shared, and opt in."
          footer={
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={handleOptIn}
                loading={submitting}
                loadingLabel="Opting in"
                disabled={!canOptIn}
              >
                Opt in
              </Button>
              {!canOptIn && (
                <span className="text-xs text-muted">
                  Pick an industry, enter your headcount, and tick the acknowledgement.
                </span>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <Select
              label="Industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            >
              <option value="">Choose an industry…</option>
              {(catalog?.industries ?? []).map((code) => (
                <option key={code} value={code}>
                  {INDUSTRY_LABELS[code] ?? code}
                </option>
              ))}
            </Select>

            <Input
              label="Employee count"
              type="number"
              min={1}
              value={employeeCount}
              onChange={(e) => setEmployeeCount(e.target.value)}
              hint={
                catalog?.sizeBands
                  ? `Bands: ${catalog.sizeBands.map((b) => b.label).join(', ')} employees.`
                  : null
              }
            />

            <label className="flex items-start gap-2 text-sm text-charcoal">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                I have read the description above of what is and is not shared, and I understand
                that withdrawing removes our data from published figures at the next monthly
                recomputation.
              </span>
            </label>
          </div>
        </Card>
      )}

      {confirmWithdraw && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="withdraw-title"
        >
          <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
            <h2 id="withdraw-title" className="text-lg font-semibold text-charcoal">
              Withdraw from the benchmark pool?
            </h2>
            <p className="mt-2 text-sm text-muted">
              Your data is removed from all published figures at the next monthly recomputation.
              After withdrawal your dashboard will no longer show benchmark comparisons, because
              reading requires contributing.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setConfirmWithdraw(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleWithdraw}
                loading={submitting}
                loadingLabel="Withdrawing"
              >
                Withdraw
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BenchmarkPage
