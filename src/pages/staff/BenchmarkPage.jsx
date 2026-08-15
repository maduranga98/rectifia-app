import { useTranslation } from 'react-i18next'
import BenchmarkComparison from '../../components/dashboard/BenchmarkComparison'

// The HR Coordinator's view of Module 25's benchmark pool. Given a page of
// its own rather than an overview tile because a cell is a full row of stats
// with a supression state that has to be readable at first glance, and
// squeezing that into an overview grid buries either the numbers or the
// context that makes them safe to read.
function BenchmarkPage({ companyId }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <p className="max-w-2xl text-sm text-muted">{t('staffBenchmarkPage.description')}</p>
      <BenchmarkComparison companyId={companyId} />
    </div>
  )
}

export default BenchmarkPage
