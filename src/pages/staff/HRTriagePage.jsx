import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNow, useReassign } from '../../hooks/useCaseTable'
import CasesTable from '../../components/dashboard/CasesTable'
import CaseTriageModal from '../../components/dashboard/CaseTriageModal'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import { SkeletonList } from '../../components/ui/Loading'

// Which rows offer "View". Triage is reading an unassigned case in order to
// place it, so a row is triageable only while there is nothing else to read it
// for: no handler yet, a status getCaseForTriage will still answer on, and not
// a conflict-of-interest case - those are the platform operator's, and the
// callable refuses this role outright. Gating here is presentation; the same
// three conditions are enforced server-side, so a row that slips through gets a
// permission-denied rather than a case.
const TRIAGE_STATUSES = ['open', 'needs_manual_assignment']

function isTriageable(caseRow) {
  return (
    !caseRow.assignedHandlerId &&
    TRIAGE_STATUSES.includes(caseRow.status) &&
    caseRow.routingReason !== 'conflict_of_interest'
  )
}

// The same table as All cases, pre-filtered to the rows still awaiting triage,
// with the "View" action that opens CaseTriageModal - the one place either
// oversight role reads an unassigned case's content in order to place it.
// Triage is a distinct job, which is why it is a page of its own rather than a
// button on every row of the main queue.
function HRTriagePage({ companyId, cases, handlers, loading, error, refresh }) {
  const { t } = useTranslation()
  const now = useNow()
  const { reassigningId, reassignError, handleReassign } = useReassign(companyId, refresh)
  const [triageCaseId, setTriageCaseId] = useState(null)
  const firstLoad = loading && cases.length === 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">{t('hrTriagePage.description')}</p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel={t('hrCasesPage.refreshing')}>
          {t('hrCasesPage.refresh')}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {reassignError && <Alert variant="error">{reassignError}</Alert>}

      {firstLoad ? (
        <SkeletonList rows={5} />
      ) : (
        <CasesTable
          cases={cases}
          handlers={handlers}
          now={now}
          prefilter={isTriageable}
          showTriageColumn
          onTriage={setTriageCaseId}
          onReassign={handleReassign}
          reassigningId={reassigningId}
        />
      )}

      {triageCaseId && (
        <CaseTriageModal
          caseId={triageCaseId}
          companyId={companyId}
          onClose={() => setTriageCaseId(null)}
          onAssigned={refresh}
        />
      )}
    </div>
  )
}

export default HRTriagePage
