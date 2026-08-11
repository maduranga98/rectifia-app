import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  caseCountCaveat,
  crossCategoryCaveat,
  describeSignal,
  formatSignalDate,
  listHandlerPatternSignals,
  signalTypeLabel,
  signalsContainingCase,
} from '../../services/patternService'
import Alert from '../ui/Alert'

// Inline notice on a Case Handler's case detail view, shown only when this
// case is inside an active pattern signal. It sits alongside the consistency
// flag and behaves the same way: it is context, not an instruction. It does
// not change the case's priority, does not route anything, does not suggest a
// finding, and does not gate any button on the page.
//
// The handler sees signals their own cases are in and no others - matched
// server-side on handlerIds by firestore.rules, not by filtering here. The
// other case ids in the signal are never rendered and would not be readable
// by this handler if they were: cases/{caseId} is still gated on
// assignedHandlerId.
function RelatedPatternNotice({ caseId }) {
  const { t } = useTranslation()
  const [signals, setSignals] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const rows = await listHandlerPatternSignals()
        if (!cancelled) setSignals(signalsContainingCase(rows, caseId))
      } catch {
        // A signal is supplementary context. If it can't be loaded, the case
        // view still works in full - failing loudly here would put an error
        // banner on a page whose actual work is unaffected.
        if (!cancelled) setSignals([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [caseId])

  if (signals.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {signals.map((signal) => (
        <Alert
          key={signal.id}
          variant="info"
          title={t('relatedPatternNotice.title', {
            signalType: signalTypeLabel(signal.signalType) ?? signal.signalType,
          })}
        >
          <p>
            {t('relatedPatternNotice.line', {
              department: signal.department,
              roleTier: String(signal.roleTier).replace(/_/g, ' '),
              description: describeSignal(signal),
            })}
          </p>
          <p className="mt-1.5 text-xs">
            {t('relatedPatternNotice.dateRange', {
              first: formatSignalDate(signal.firstReportedAt),
              last: formatSignalDate(signal.lastReportedAt),
            })}
          </p>
          {signal.signalType === 'cross_category' && (
            <p className="mt-1.5 text-xs">{crossCategoryCaveat()}</p>
          )}
          <p className="mt-1.5 text-xs">{caseCountCaveat()}</p>
          <p className="mt-1.5 text-xs">{t('relatedPatternNotice.informationalOnly')}</p>
        </Alert>
      ))}
    </div>
  )
}

export default RelatedPatternNotice
