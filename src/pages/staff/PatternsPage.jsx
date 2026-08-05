import PatternSignals from '../../components/dashboard/PatternSignals'

// PatternSignals, given a page of its own and the full width. A cluster lives
// across rows rather than in one, so it is the thing a queue view cannot show;
// here it is the whole view. The component's internals are unchanged - it reads
// the same patternSignals collection derived from the metadata mirror.
function PatternsPage({ companyId }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="max-w-2xl text-sm text-muted">
        Clusters of related reports across the company, derived from case metadata only.
      </p>
      <PatternSignals companyId={companyId} />
    </div>
  )
}

export default PatternsPage
