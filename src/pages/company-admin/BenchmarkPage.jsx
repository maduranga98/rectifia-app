import { useCallback, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4 text-sm text-charcoal">
      <div>
        <p className="font-semibold">{t('adminBenchmarkPage.disclosure.leaves.title')}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>{t('adminBenchmarkPage.disclosure.leaves.category')}</li>
          <li>{t('adminBenchmarkPage.disclosure.leaves.scores')}</li>
          <li>{t('adminBenchmarkPage.disclosure.leaves.tier')}</li>
          <li>{t('adminBenchmarkPage.disclosure.leaves.action')}</li>
          <li>{t('adminBenchmarkPage.disclosure.leaves.closedDate')}</li>
          <li>{t('adminBenchmarkPage.disclosure.leaves.industryBand')}</li>
        </ul>
      </div>
      <div>
        <p className="font-semibold">{t('adminBenchmarkPage.disclosure.never.title')}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>{t('adminBenchmarkPage.disclosure.never.narrative')}</li>
          <li>{t('adminBenchmarkPage.disclosure.never.names')}</li>
          <li>{t('adminBenchmarkPage.disclosure.never.identity')}</li>
          <li>{t('adminBenchmarkPage.disclosure.never.caseId')}</li>
          <li>{t('adminBenchmarkPage.disclosure.never.deptNames')}</li>
          <li>{t('adminBenchmarkPage.disclosure.never.companyIdentity')}</li>
        </ul>
      </div>
      <div>
        <p className="font-semibold">{t('adminBenchmarkPage.disclosure.withdraw.title')}</p>
        <p className="mt-1.5">{t('adminBenchmarkPage.disclosure.withdraw.body')}</p>
      </div>
    </div>
  )
}

function OptInStatusBadge({ optedIn }) {
  const { t } = useTranslation()
  if (optedIn) return <Badge tone="tone-low" dot>{t('adminBenchmarkPage.optedIn')}</Badge>
  return <Badge tone="tone-neutral" dot>{t('adminBenchmarkPage.notOptedIn')}</Badge>
}

// The Company Admin's opt-in control for Module 25. This page never renders
// the pool's numbers - that is the HR Coordinator's dashboard. Here it is
// consent, industry+headcount declaration, and withdrawal.
function BenchmarkPage({ companyId }) {
  const { t } = useTranslation()
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
      setNotice(t('adminBenchmarkPage.optInSuccess'))
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
      setNotice(t('adminBenchmarkPage.withdrawSuccess'))
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
      <p className="max-w-2xl text-sm text-muted">{t('adminBenchmarkPage.intro')}</p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card
        title={t('adminBenchmarkPage.participation.title')}
        description={t('adminBenchmarkPage.participation.description')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <OptInStatusBadge optedIn={optedIn} />
          {optedIn && status?.industry && (
            <span className="text-sm text-muted">
              <Trans
                i18nKey="adminBenchmarkPage.contributingAs"
                values={{
                  industry: INDUSTRY_LABELS[status.industry] ?? status.industry,
                  band: status.sizeBand ?? '—',
                }}
                components={{ strong: <strong className="text-charcoal" /> }}
              />
            </span>
          )}
          {optedIn && status?.incomplete && (
            <Alert variant="warning">{t('adminBenchmarkPage.incompleteCellWarning')}</Alert>
          )}
        </div>
      </Card>

      <Card
        title={t('adminBenchmarkPage.sharedData.title')}
        description={t('adminBenchmarkPage.sharedData.description')}
      >
        <SharedDataDisclosure />
      </Card>

      {optedIn ? (
        <Card
          title={t('adminBenchmarkPage.withdrawCard.title')}
          description={t('adminBenchmarkPage.withdrawCard.description')}
          footer={
            <div className="flex items-center gap-3">
              <Button
                variant="danger"
                onClick={() => setConfirmWithdraw(true)}
                disabled={submitting}
              >
                {t('adminBenchmarkPage.withdrawCard.button')}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted">{t('adminBenchmarkPage.withdrawCard.body')}</p>
        </Card>
      ) : (
        <Card
          title={t('adminBenchmarkPage.optInCard.title')}
          description={t('adminBenchmarkPage.optInCard.description')}
          footer={
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={handleOptIn}
                loading={submitting}
                loadingLabel={t('adminBenchmarkPage.optInCard.loading')}
                disabled={!canOptIn}
              >
                {t('adminBenchmarkPage.optInCard.button')}
              </Button>
              {!canOptIn && (
                <span className="text-xs text-muted">{t('adminBenchmarkPage.optInCard.hint')}</span>
              )}
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <Select
              label={t('adminBenchmarkPage.optInCard.industryLabel')}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            >
              <option value="">{t('adminBenchmarkPage.optInCard.industryPlaceholder')}</option>
              {(catalog?.industries ?? []).map((code) => (
                <option key={code} value={code}>
                  {INDUSTRY_LABELS[code] ?? code}
                </option>
              ))}
            </Select>

            <Input
              label={t('adminBenchmarkPage.optInCard.employeeCountLabel')}
              type="number"
              min={1}
              value={employeeCount}
              onChange={(e) => setEmployeeCount(e.target.value)}
              hint={
                catalog?.sizeBands
                  ? t('adminBenchmarkPage.optInCard.employeeCountHint', {
                      bands: catalog.sizeBands.map((b) => b.label).join(', '),
                    })
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
              <span>{t('adminBenchmarkPage.optInCard.acknowledgement')}</span>
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
              {t('adminBenchmarkPage.withdrawModal.title')}
            </h2>
            <p className="mt-2 text-sm text-muted">{t('adminBenchmarkPage.withdrawModal.body')}</p>
            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setConfirmWithdraw(false)}
                disabled={submitting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={handleWithdraw}
                loading={submitting}
                loadingLabel={t('adminBenchmarkPage.withdrawModal.loading')}
              >
                {t('adminBenchmarkPage.withdrawModal.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BenchmarkPage
