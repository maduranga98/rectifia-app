import { ROLES } from '../../constants/roles'
import { AggregateTrendsView } from '../../components/pulse-check/PulseTrendDashboard'

// Department and period sentiment averages - never an individual response.
// Two roles land here with two scopings, both enforced by firestore.rules and
// unchanged from before the split:
//   - Manager ("Team wellness"): scoped to the account's own department claim.
//     Its scoping and suppression behaviour must not change, so the manager's
//     `departments` are passed straight through to the aggregate query.
//   - Pulse Check Reviewer ("Trends"): reads every company aggregate; passing
//     no departments is the unconditional read its rules path already allows.
function PulseTrendsPage({ companyId, role, departments }) {
  const scopedDepartments = role === ROLES.MANAGER ? departments : undefined

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        Department and period averages. Individual responses are never attributed to a person here.
      </p>
      <AggregateTrendsView companyId={companyId} departments={scopedDepartments} />
    </div>
  )
}

export default PulseTrendsPage
