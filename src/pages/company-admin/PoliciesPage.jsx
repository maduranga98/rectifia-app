import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  POLICY_CATEGORIES,
  archivePolicy,
  deletePolicy,
  getPolicyDownloadUrl,
  listPolicies,
  restorePolicy,
} from '../../services/policyService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { SkeletonList } from '../../components/ui/Loading'
import PolicyUpload from '../../components/dashboard/PolicyUpload'

const STATUS_TONE = {
  active: 'tone-low',
  processing: 'tone-info',
  archived: 'tone-neutral',
  failed: 'tone-critical',
}

function formatDate(value) {
  const millis = value?.toMillis?.() ?? (typeof value === 'number' ? value : null)
  if (!millis) return '-'
  return new Date(millis).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Company Admin's policy shelf (module 19). Upload, version, archive, restore
// and delete only - there is deliberately no in-app editing, since the source
// of truth stays the company's own document. Nothing here touches case content:
// this role uploads and manages the written rules that ground the AI, but never
// sees a case, a score, or which clauses any case matched.
function PoliciesPage({ companyId }) {
  const { t } = useTranslation()
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPolicies(await listPolicies(companyId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  async function runAction(policyId, action) {
    setBusyId(policyId)
    setError(null)
    try {
      await action(policyId)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(policy) {
    if (!window.confirm(t('policiesPage.confirmDelete', { title: policy.title, version: policy.version }))) {
      return
    }
    await runAction(policy.id, deletePolicy)
  }

  async function handleOpen(policyId) {
    setError(null)
    try {
      const url = await getPolicyDownloadUrl(policyId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err.message)
    }
  }

  // Coverage: which categories any *active* policy can ground, and which have
  // nothing. This is the at-a-glance answer to "we have a harassment policy but
  // nothing burnout can draw on".
  const activePolicies = policies.filter((p) => p.status === 'active')
  const coveredCategories = new Set(activePolicies.flatMap((p) => p.categoriesCovered))
  const uncovered = POLICY_CATEGORIES.filter((c) => !coveredCategories.has(c.id))

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">{t('policiesPage.description')}</p>

      {error && <Alert variant="error">{error}</Alert>}

      <Card title={t('policiesPage.coverage.title')} description={t('policiesPage.coverage.description')}>
        <div className="flex flex-wrap gap-2">
          {POLICY_CATEGORIES.map((category) => {
            const covered = coveredCategories.has(category.id)
            return (
              <Badge key={category.id} tone={covered ? 'tone-low' : 'tone-neutral'} dot>
                {t(`categories.${category.id}.label`)}:{' '}
                {covered ? t('policiesPage.coverage.covered') : t('policiesPage.coverage.noPolicy')}
              </Badge>
            )
          })}
        </div>
        {uncovered.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {t('policiesPage.coverage.nothingFor', {
              categories: uncovered.map((c) => t(`categories.${c.id}.label`)).join(', '),
            })}
          </p>
        )}
      </Card>

      <Card title={t('policiesPage.uploadTitle')}>
        <PolicyUpload companyId={companyId} onUploaded={refresh} />
      </Card>

      {loading && policies.length === 0 ? (
        <SkeletonList rows={3} />
      ) : (
        <Card
          title={t('policiesPage.documents.title')}
          description={t('policiesPage.documents.uploadedCount', { count: policies.length })}
          padded={false}
        >
          {policies.length === 0 ? (
            <EmptyState
              icon="document"
              title={t('policiesPage.documents.empty.title')}
              description={t('policiesPage.documents.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {policies.map((policy) => (
                <li key={policy.id} className="flex flex-col gap-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-charcoal">{policy.title}</span>
                    <Badge tone={STATUS_TONE[policy.status] ?? 'tone-neutral'} dot>
                      {t(`policiesPage.status.${policy.status}`, { defaultValue: policy.status })}
                    </Badge>
                    <span className="text-xs text-muted">v{policy.version}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    <span>{policy.fileName}</span>
                    <span>{t('policiesPage.chunkCount', { count: policy.chunkCount })}</span>
                    <span>{t('policiesPage.uploaded', { date: formatDate(policy.uploadedAt) })}</span>
                  </div>

                  {policy.status === 'failed' && policy.errorMessage && (
                    <p className="text-xs text-critical">{policy.errorMessage}</p>
                  )}

                  {policy.categoriesCovered.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {policy.categoriesCovered.map((category) => (
                        <span
                          key={category}
                          className="rounded-full bg-navy-50 px-2 py-0.5 text-xs text-navy"
                        >
                          {t(`categories.${category}.label`, { defaultValue: category })}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {(policy.status === 'active' || policy.status === 'archived') && (
                      <Button variant="secondary" size="sm" icon="document" onClick={() => handleOpen(policy.id)}>
                        {t('policiesPage.open')}
                      </Button>
                    )}
                    {policy.status === 'active' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === policy.id}
                        onClick={() => runAction(policy.id, archivePolicy)}
                      >
                        {t('policiesPage.archive')}
                      </Button>
                    )}
                    {policy.status === 'archived' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === policy.id}
                        onClick={() => runAction(policy.id, restorePolicy)}
                      >
                        {t('policiesPage.restore')}
                      </Button>
                    )}
                    <Button
                      variant="dangerGhost"
                      size="sm"
                      disabled={busyId === policy.id}
                      onClick={() => handleDelete(policy)}
                    >
                      {t('departmentsPage.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

export default PoliciesPage
