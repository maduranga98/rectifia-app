import { useTranslation } from 'react-i18next'
import BurnoutTrendSignals from '../../components/dashboard/BurnoutTrendSignals'
import PatternSignals from '../../components/dashboard/PatternSignals'
import { useFeatureFlag } from '../../hooks/useFeatureFlag'

// PatternSignals, given a page of its own and the full width. A cluster lives
// across rows rather than in one, so it is the thing a queue view cannot show;
// here it is the whole view. The component's internals are unchanged - it reads
// the same patternSignals collection derived from the metadata mirror.
//
// BurnoutTrendSignals sits below it as its own section, not folded into
// PatternSignals - the two read separate collections derived from separate
// grouping keys (subject signature vs. reporter department) and must stay
// visibly distinct so a burnout report-volume count is never mistaken for a
// repeated-conduct cluster.
function PatternsPage({ companyId }) {
  const { t } = useTranslation()
  const { enabled: burnoutTrendDetectionEnabled } = useFeatureFlag('burnoutTrendDetection')
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="max-w-2xl text-sm text-muted">{t('patternsPage.description')}</p>
      <PatternSignals companyId={companyId} />
      {burnoutTrendDetectionEnabled && <BurnoutTrendSignals companyId={companyId} />}
    </div>
  )
}

export default PatternsPage
