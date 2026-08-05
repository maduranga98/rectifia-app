import { Fragment, useEffect, useState } from 'react'
import { getEvidenceDownloadUrl } from '../../services/caseThreadService'
import { generateReport } from '../../services/reportService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import Logo from '../ui/Logo'
import { SkeletonList } from '../ui/Loading'
import ReportExportButton from './ReportExportButton'

function formatTimestamp(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

const AUTHOR_TONE = {
  manual_log: 'tone-high',
  system: 'tone-neutral',
  ai: 'tone-info',
  investigator: 'tone-info',
  reporter: 'tone-neutral',
}

function messageAuthorLabel(message) {
  if (message.type === 'manual_log') return 'Investigator log'
  if (message.sender === 'system') return 'System'
  if (message.sender === 'ai') return 'AI assistant'
  if (message.sender === 'investigator') return 'Case Handler'
  return 'Reporter'
}

// Label/value pairs. A two-column dl at every call site was the single most
// repeated block in this file; as a component the columns stay aligned and
// an empty value renders as an em dash instead of nothing.
function DetailList({ items }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <Fragment key={label}>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted">{label}</dt>
            <dd className="text-sm text-charcoal">{value ?? '—'}</dd>
          </div>
        </Fragment>
      ))}
    </dl>
  )
}

// Evidence rows. The report carries attachment *metadata* only - the message
// documents no longer store a URL, because a stored signed URL is a permanent
// bearer credential for a confidential file. Opening one fetches a fresh URL
// valid for about 15 minutes, and the fetch is audited server-side, so an
// exported PDF of this report contains a list of what exists rather than a
// page of live links to it.
//
// The caller here is an authenticated handler, so no passcode is passed - the
// callable authorizes on the Firebase Auth identity and the case assignment.
function EvidenceRow({ caseId, item }) {
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  async function open() {
    setOpening(true)
    setFailed(false)
    try {
      const url = await getEvidenceDownloadUrl(caseId, item.fileName)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.target = '_blank'
      anchor.rel = 'noreferrer'
      anchor.click()
    } catch {
      setFailed(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium text-charcoal">{item.label ?? item.fileName}</span>
      <span className="text-xs text-muted">
        submitted by {item.postedBy} on {formatTimestamp(item.postedAt)}
      </span>
      {item.fileName && (
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className="text-xs text-navy underline disabled:no-underline disabled:opacity-60 print:hidden"
        >
          {opening ? 'Opening…' : 'Open'}
        </button>
      )}
      {failed && <span className="text-xs text-critical">Could not open this file.</span>}
    </li>
  )
}

// Renders the final case report compiled by
// functions/src/intake/generateReport.js - a read-only compile, so opening
// this view never changes case data.
//
// canViewReporterIdentity gates the restricted reporter-identity section
// (confidential-tier cases only) on top of what the backend already omits
// for anonymous-tier cases. There is no real role-based access control in
// this codebase yet (see the TODOs in caseThread.js / routeCase.js on staff
// auth) - the caller of this component is responsible for only passing
// canViewReporterIdentity=true for a viewer actually authorized to see it.
function CaseReport({ caseId, canViewReporterIdentity = false }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    generateReport(caseId)
      .then((result) => {
        if (!cancelled) setReport(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [caseId])

  if (loading) return <SkeletonList rows={5} />
  if (error) return <Alert variant="error">{error}</Alert>
  if (!report) return null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 print:max-w-none print:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Printed copies leave the app chrome behind, so the report body
              carries the mark itself. */}
          <span className="hidden print:block">
            <Logo size="sm" showWordmark={false} />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-charcoal">Case report</h2>
            <p className="text-sm text-muted">{report.caseId}</p>
          </div>
        </div>
      </div>

      <ReportExportButton
        caseId={caseId}
        hasRestrictedIdentity={Boolean(report.restrictedReporterIdentity)}
        canIncludeIdentity={canViewReporterIdentity}
      />

      <Card title="Case summary">
        <DetailList
          items={[
            ['Category', humanize(report.summary.category)],
            ['Status', humanize(report.summary.status)],
            ['Created', formatTimestamp(report.summary.createdAt)],
            ['Closed', formatTimestamp(report.summary.closedAt)],
            ['Severity score', report.summary.severityScore],
            ['Evidence score', report.summary.evidenceScore],
          ]}
        />
      </Card>

      <Card title="Message timeline" padded={report.timeline.length > 0}>
        {report.timeline.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">No messages.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {report.timeline.map((message) => (
              <li key={message.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone={AUTHOR_TONE[message.type === 'manual_log' ? 'manual_log' : message.sender] ?? 'tone-neutral'}>
                    {messageAuthorLabel(message)}
                  </Badge>
                  <span className="text-xs text-muted">{formatTimestamp(message.timestamp)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-charcoal">{message.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Evidence">
        {report.evidence.length === 0 ? (
          <p className="text-sm text-muted">No attachments.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {report.evidence.map((item) => (
              <EvidenceRow key={item.fileName ?? item.label} caseId={caseId} item={item} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Investigator manual log">
        {report.manualLogEntries.length === 0 ? (
          <p className="text-sm text-muted">No manual log entries.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.manualLogEntries.map((entry) => (
              <li key={entry.id} className="tone-high rounded-lg border px-3.5 py-3 text-sm">
                <div className="text-xs opacity-80">{formatTimestamp(entry.timestamp)}</div>
                <p className="mt-1 whitespace-pre-wrap">{entry.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Consistency check">
        {!report.consistencyCheck ? (
          <p className="text-sm text-muted">No consistency check has run for this case.</p>
        ) : (
          <DetailList
            items={[
              ['Status', humanize(report.consistencyCheck.status)],
              ['Flag', report.consistencyCheck.flag?.message ?? 'None'],
              ['Typical action', humanize(report.consistencyCheck.typicalAction)],
              ['Resolution notes', report.consistencyCheck.resolutionNotes],
            ]}
          />
        )}
      </Card>

      <Card title="Policy in effect" padded={(report.policyInEffect?.length ?? 0) > 0}>
        {!report.policyInEffect || report.policyInEffect.length === 0 ? (
          <p className="text-sm text-muted">
            No company policy was in effect for this case's category when it was created.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {report.policyInEffect.map((policy) => (
              <li key={policy.policyId} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="text-sm text-charcoal">{policy.title ?? 'Policy document'}</span>
                {policy.version != null && (
                  <span className="text-xs text-muted">Version {policy.version}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Final action taken">
        <DetailList
          items={[
            [
              'Action',
              humanize(report.finalAction.actionTaken ?? report.finalAction.proposedAction) ??
                'Not yet decided',
            ],
            ['Effective date', formatTimestamp(report.finalAction.actionEffectiveDate)],
            ['Notes', report.finalAction.actionNotes],
          ]}
        />
      </Card>

      <Card title="Compliance deadline log">
        <DetailList
          items={[
            ['Rule applied', report.complianceDeadlineLog.complianceRuleApplied],
            ['Acknowledgment due', formatTimestamp(report.complianceDeadlineLog.acknowledgmentDueAt)],
            ['Acknowledgment sent', formatTimestamp(report.complianceDeadlineLog.acknowledgmentSentAt)],
            ['Feedback due', formatTimestamp(report.complianceDeadlineLog.feedbackDueAt)],
            ['Feedback given', formatTimestamp(report.complianceDeadlineLog.feedbackGivenAt)],
          ]}
        />
      </Card>

      <Card
        title="External shares"
        description="Who this case was shared with outside the organisation - who saw this case is part of the case history."
      >
        {!report.externalShares || report.externalShares.length === 0 ? (
          <p className="text-sm text-muted">No external shares were ever created for this case.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {report.externalShares.map((share, index) => (
              <li key={index} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-charcoal">
                    {share.recipientOrganisation ?? 'Unknown organisation'}
                  </span>
                  <Badge
                    tone={
                      share.status === 'revoked'
                        ? 'tone-critical'
                        : share.status === 'expired'
                          ? 'tone-neutral'
                          : 'tone-low'
                    }
                    dot
                  >
                    {humanize(share.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {share.recipientName} · {share.scope} scope · created {formatTimestamp(share.createdAt)} · expires{' '}
                  {formatTimestamp(share.expiresAt)}
                </p>
                <p className="mt-1 text-sm text-charcoal">{share.purpose}</p>
                <p className="mt-1 text-xs text-muted">
                  {share.accessCount ?? 0} access(es)
                  {share.lastAccessedAt ? `, last ${formatTimestamp(share.lastAccessedAt)}` : ''}
                  {share.status === 'revoked' && share.revokedReason ? ` · revoked: ${share.revokedReason}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {report.restrictedReporterIdentity && (
        <Card
          title="Restricted - reporter identity"
          description="Confidential tier. Visible only to roles authorized to see reporter identity."
          className="border-critical/40"
        >
          {canViewReporterIdentity ? (
            <DetailList
              items={[
                ['Status', report.restrictedReporterIdentity.status],
                ['Details on file', report.restrictedReporterIdentity.detailsOnFile],
                ['Access', report.restrictedReporterIdentity.access],
                // Present only when the case CHANGED tier mid-investigation -
                // i.e. the reporter filed anonymously and later chose to
                // identify themselves. A case that was confidential from its
                // first message has no such row, and the difference matters to
                // whoever reads this: the early part of the thread was written
                // by someone the investigator could not name.
                ...(report.restrictedReporterIdentity.tierChanged
                  ? [
                      [
                        'Identified themselves',
                        `${formatTimestamp(report.restrictedReporterIdentity.tierChanged.at)} (${
                          report.restrictedReporterIdentity.tierChanged.by
                        }) - ${report.restrictedReporterIdentity.tierChanged.note}`,
                      ],
                    ]
                  : []),
              ].filter(([, value]) => value)}
            />
          ) : (
            <Alert variant="error">
              You are not authorized to view reporter identity for this case.
            </Alert>
          )}
        </Card>
      )}
    </div>
  )
}

export default CaseReport
