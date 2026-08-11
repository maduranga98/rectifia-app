import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listCaseHandlers, listCasesMissingRoutingRule, reassignCase } from '../../services/routingService'
import { auth } from '../../services/firebase'
import { CATEGORIES } from '../../data/categories'
import CaseTriageModal from '../../components/dashboard/CaseTriageModal'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { SkeletonList } from '../../components/ui/Loading'

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
}

function formatDate(value) {
  const ms = value?.toMillis?.() ?? (typeof value === 'number' ? value : null)
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// A dedicated home for the Company Admin's triage work. The view-and-assign
// flow already existed - the "Needs attention" card on RoutingRulesPage has
// carried it - but it only surfaced there as a side effect of configuring
// routing, so an admin who simply wanted to read a waiting report and place
// it had nowhere obvious to go. This page makes that the whole point.
//
// The cases shown are exactly the ones firestore.rules lets this role read:
// caseMetadata/{caseId} where status == 'needs_manual_assignment' and
// routingReason == 'no_routing_rule' (see listCasesMissingRoutingRule). This
// page deliberately does NOT widen that scope - it reuses the same metadata-
// only query, so it can't show a case the rules would deny. Case *content*
// still appears only inside CaseTriageModal, which reads it through the
// getCaseForTriage callable's server-side allowlist; the list here is
// metadata only, the same as every other company-admin surface.
function CasesPage({ companyId }) {
  const { t } = useTranslation()
  const [cases, setCases] = useState([])
  const [handlers, setHandlers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [assigningCaseId, setAssigningCaseId] = useState(null)
  const [triageCaseId, setTriageCaseId] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [caseRows, handlerRows] = await Promise.all([
        listCasesMissingRoutingRule(companyId),
        listCaseHandlers(companyId),
      ])
      setCases(caseRows)
      setHandlers(handlerRows)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  // The same reassignCase callable the HR Coordinator dashboard, the triage
  // modal and RoutingRulesPage all use - cases/{caseId} is not client-
  // writable, so there is a single server-side assignment path to keep the
  // conflict-of-interest and company-match guards in step.
  async function handleAssignCase(caseRow, handlerId) {
    if (!handlerId) return
    setAssigningCaseId(caseRow.caseId)
    setError(null)
    setNotice(null)
    try {
      await reassignCase({
        caseId: caseRow.caseId,
        companyId,
        handlerId,
        actorId: auth.currentUser?.uid,
      })
      setNotice(t('adminCasesPage.caseAssigned', { caseId: caseRow.caseId }))
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setAssigningCaseId(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">{t('adminCasesPage.description')}</p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel={t('hrCasesPage.refreshing')}>
          {t('hrCasesPage.refresh')}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {loading && cases.length === 0 ? (
        <SkeletonList rows={3} />
      ) : (
        <Card
          title={t('adminCasesPage.awaitingAssignment')}
          description={t('adminCasesPage.casesWaiting', { count: cases.length })}
          padded={false}
        >
          {cases.length === 0 ? (
            <EmptyState
              icon="cases"
              title={t('adminCasesPage.noCasesWaiting.title')}
              description={t('adminCasesPage.noCasesWaiting.description')}
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {cases.map((caseRow) => (
                <li key={caseRow.caseId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold text-charcoal">{caseRow.caseId}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>
                        {CATEGORIES.some((c) => c.id === caseRow.category)
                          ? t(`categories.${caseRow.category}.label`)
                          : (caseRow.category ?? t('adminCasesPage.uncategorized'))}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{caseRow.department ?? t('adminCasesPage.unspecified')}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t('adminCasesPage.submitted', { date: formatDate(caseRow.createdAt) })}</span>
                    </p>
                  </div>

                  {caseRow.priority && (
                    <Badge tone={PRIORITY_TONE[caseRow.priority] ?? 'tone-neutral'} dot>
                      {caseRow.priority}
                    </Badge>
                  )}

                  <Button
                    variant="secondary"
                    size="sm"
                    icon="document"
                    onClick={() => setTriageCaseId(caseRow.caseId)}
                  >
                    {t('adminCasesPage.view')}
                  </Button>

                  <select
                    aria-label={t('adminCasesPage.assignCaseLabel', { caseId: caseRow.caseId })}
                    className="field w-44 py-1 text-xs"
                    value=""
                    disabled={assigningCaseId === caseRow.caseId || handlers.length === 0}
                    onChange={(e) => handleAssignCase(caseRow, e.target.value)}
                  >
                    <option value="" disabled>
                      {assigningCaseId === caseRow.caseId
                        ? t('adminCasesPage.assigning')
                        : handlers.length === 0
                          ? t('adminCasesPage.noHandlersYet')
                          : t('adminCasesPage.assignTo')}
                    </option>
                    {handlers.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.email ?? h.id}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {triageCaseId && (
        <CaseTriageModal
          caseId={triageCaseId}
          companyId={companyId}
          onClose={() => setTriageCaseId(null)}
          onAssigned={(caseId) => {
            setNotice(t('adminCasesPage.caseAssigned', { caseId }))
            refresh()
          }}
        />
      )}
    </div>
  )
}

export default CasesPage
