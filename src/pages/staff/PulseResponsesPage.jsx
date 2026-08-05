import { IndividualResponsesView } from '../../components/pulse-check/PulseTrendDashboard'

// Individual, named pulse-check responses and their AI sentiment summaries.
// The only roles that reach this page - HR Coordinator and Pulse Check
// Reviewer - are exactly the two firestore.rules grants a read path to
// pulseResponses; a wrong role's own data call is denied at the Firestore
// layer, not hidden here.
function PulseResponsesPage({ companyId }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        Individual pulse check responses with their AI sentiment summaries.
      </p>
      <IndividualResponsesView companyId={companyId} />
    </div>
  )
}

export default PulseResponsesPage
