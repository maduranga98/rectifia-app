import { Link } from 'react-router-dom'
import { policyVersion } from '../../content/legal/privacyPolicy'

// Shown at category selection - before the reporter has typed a single word
// of their actual report - never at final submit. By the time someone
// reaches a "review and submit" screen they have already written the thing
// this notice is meant to warn them about; the only point where the warning
// can still change their mind is before they start.
//
// This is deliberately NOT a place to collect anything new: the value it
// produces is a boolean plus a timestamp plus which version of the policy
// was current when they saw it - never a name, email, or any other personal
// field. Crisis resources are reachable from ReporterLayout's "Need support
// now?" toggle regardless of whether this box is ever checked - nothing here
// gates that.
//
// Controlled component: `acknowledgment` is either null (not yet
// acknowledged) or { acknowledged: true, acknowledgedAt, policyVersion },
// exactly the shape functions/src/intake/submitCase.js requires and stores
// on the case document. The parent (Submit.jsx) owns this state because it
// has to survive the reporter navigating back and forth between steps, and
// because it's the parent that assembles the final submitCase payload.
function DataHandlingNotice({ acknowledgment, onChange }) {
  const acknowledged = Boolean(acknowledgment?.acknowledged)

  function handleToggle(event) {
    if (event.target.checked) {
      onChange({
        acknowledged: true,
        acknowledgedAt: new Date().toISOString(),
        policyVersion,
      })
    } else {
      onChange(null)
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-5">
      <h2 className="text-sm font-semibold text-charcoal">Before you continue</h2>

      <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-muted">
        <li>
          Your answers are sent to an AI system (Anthropic) that scores your report and helps
          route it to the right handler.
        </li>
        <li>
          The AI never decides your case&apos;s outcome — every action it proposes is reviewed
          and decided by a person.
        </li>
        <li>
          Choosing to stay anonymous later means no name, email, or phone number is ever
          collected; choosing to be confidential means only your assigned investigator can ever
          learn who you are, and only if you choose to tell them.
        </li>
        <li>
          You&apos;ll get a Case ID and a one-time passcode when you file — if you lose either,
          they cannot be recovered or reset.
        </li>
      </ul>

      <label className="mt-1 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface p-3 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={handleToggle}
          className="mt-0.5 h-4 w-4"
        />
        <span className="text-charcoal">
          I understand how my report will be handled.{' '}
          <Link
            to="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-navy underline hover:text-navy-600"
          >
            Read the full privacy policy
          </Link>{' '}
          <span className="text-xs text-muted">(opens in a new tab, your progress is kept)</span>
        </span>
      </label>
    </div>
  )
}

export default DataHandlingNotice
