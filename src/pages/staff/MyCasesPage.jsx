import { useNavigate } from 'react-router-dom'
import HandlerDashboard from '../../components/investigation/HandlerDashboard'

// A Case Handler's own queue. Selecting a case now navigates to its own route
// (/dashboard/cases/:caseId) rather than swapping an in-page view, so a case a
// handler is working is refreshable, bookmarkable, and shareable with whoever
// it gets reassigned to. HandlerDashboard itself is unchanged - it still lists
// only the caller's assigned cases, enforced by firestore.rules.
function MyCasesPage() {
  const navigate = useNavigate()
  return <HandlerDashboard onSelectCase={(caseId) => navigate(`/dashboard/cases/${caseId}`)} />
}

export default MyCasesPage
