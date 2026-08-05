import FollowUpStatus from '../../components/dashboard/FollowUpStatus'
import Alert from '../../components/ui/Alert'
import { SkeletonList } from '../../components/ui/Loading'

// The retaliation follow-up rollup, full width. FollowUpStatus reads the same
// shared caseMetadata load this role already has - counts and statuses only,
// never the reporter's free-text answer. Its internals are untouched; it just
// gets a page and a heading here.
function FollowUpsPage({ cases, loading, error }) {
  const firstLoad = loading && cases.length === 0

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <p className="max-w-2xl text-sm text-muted">
        Where each case stands on its post-resolution retaliation check-in.
      </p>

      {error && <Alert variant="error">{error}</Alert>}

      {firstLoad ? <SkeletonList rows={4} /> : <FollowUpStatus cases={cases} />}
    </div>
  )
}

export default FollowUpsPage
