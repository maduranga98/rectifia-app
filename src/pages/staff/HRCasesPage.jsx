import { useNow, useReassign } from '../../hooks/useCaseTable'
import CasesTable from '../../components/dashboard/CasesTable'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import { SkeletonList } from '../../components/ui/Loading'

// The full company case table - filters, sorting, pagination and CSV export -
// over every case, reading the shared caseMetadata load. Triage lives on its
// own page now, so this table carries no triage column; reassignment stays
// here, since placing an already-routed case is part of oversight.
function HRCasesPage({ companyId, cases, handlers, loading, error, refresh }) {
  const now = useNow()
  const { reassigningId, reassignError, handleReassign } = useReassign(companyId, refresh)
  const firstLoad = loading && cases.length === 0

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Every case in the company, by metadata only.
        </p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
          Refresh
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
          onReassign={handleReassign}
          reassigningId={reassigningId}
        />
      )}
    </div>
  )
}

export default HRCasesPage
