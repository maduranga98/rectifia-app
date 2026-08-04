import { useEffect, useState } from 'react'
import {
  CASE_COUNT_CAVEAT,
  CROSS_CATEGORY_CAVEAT,
  SIGNAL_TYPE_LABEL,
  describeSignal,
  formatSignalDate,
  listHandlerPatternSignals,
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
          title={`Part of a pattern signal - ${SIGNAL_TYPE_LABEL[signal.signalType] ?? signal.signalType}`}
        >
          <p>
            {signal.department} / {String(signal.roleTier).replace(/_/g, ' ')}: {describeSignal(signal)}
          </p>
          <p className="mt-1.5 text-xs">
            First {formatSignalDate(signal.firstReportedAt)}, most recent{' '}
            {formatSignalDate(signal.lastReportedAt)}. This case is one of them.
          </p>
          {signal.signalType === 'cross_category' && (
            <p className="mt-1.5 text-xs">{CROSS_CATEGORY_CAVEAT}</p>
          )}
          <p className="mt-1.5 text-xs">{CASE_COUNT_CAVEAT}</p>
          <p className="mt-1.5 text-xs">
            Informational only. It does not suggest a finding or an action on this case, and the
            other cases behind this count are not yours to read.
          </p>
        </Alert>
      ))}
    </div>
  )
}

export default RelatedPatternNotice
