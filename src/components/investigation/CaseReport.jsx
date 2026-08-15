import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getEvidenceDownloadUrl } from '../../services/caseThreadService'
import { generateReport } from '../../services/reportService'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import Logo from '../ui/Logo'
import { SkeletonList } from '../ui/Loading'
import ReportExportButton from './ReportExportButton'

function formatTimestamp(ms) {
  if (!ms) return '-'
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

function messageAuthorLabel(t, message) {
  if (message.type === 'manual_log') return t('caseReport.author.investigatorLog')
  if (message.sender === 'system') return t('caseReport.author.system')
  if (message.sender === 'ai') return t('caseReport.author.aiAssistant')
  if (message.sender === 'investigator') return t('caseReport.author.caseHandler')
  return t('caseReport.author.reporter')
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
            <dd className="text-sm text-charcoal">{value ?? '-'}</dd>
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
  const { t } = useTranslation()
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
        {t('caseReport.submittedByOn', { by: item.postedBy, date: formatTimestamp(item.postedAt) })}
      </span>
      {item.fileName && (
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className="text-xs text-navy underline disabled:no-underline disabled:opacity-60 print:hidden"
        >
          {opening ? t('caseReport.openingEllipsis') : t('caseReport.open')}
        </button>
      )}
      {failed && <span className="text-xs text-critical">{t('caseReport.couldNotOpen')}</span>}
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
  const { t } = useTranslation()
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
            <h2 className="text-xl font-semibold text-charcoal">{t('caseReport.title')}</h2>
            <p className="text-sm text-muted">{report.caseId}</p>
          </div>
        </div>
      </div>

      <ReportExportButton
        caseId={caseId}
        hasRestrictedIdentity={Boolean(report.restrictedReporterIdentity)}
        canIncludeIdentity={canViewReporterIdentity}
      />

      <Card title={t('caseReport.summary.title')}>
        <DetailList
          items={[
            [t('caseReport.summary.category'), report.summary.category ? t(`categories.${report.summary.category}.label`, { defaultValue: humanize(report.summary.category) }) : humanize(report.summary.category)],
            [t('caseReport.summary.status'), t(`caseStatus.${report.summary.status}`, { defaultValue: humanize(report.summary.status) })],
            [t('caseReport.summary.created'), formatTimestamp(report.summary.createdAt)],
            [t('caseReport.summary.closed'), formatTimestamp(report.summary.closedAt)],
            [t('caseReport.summary.severityScore'), report.summary.severityScore],
            [t('caseReport.summary.evidenceScore'), report.summary.evidenceScore],
          ]}
        />
      </Card>

      <Card title={t('caseReport.timeline.title')} padded={report.timeline.length > 0}>
        {report.timeline.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">{t('caseReport.timeline.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {report.timeline.map((message) => (
              <li key={message.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone={AUTHOR_TONE[message.type === 'manual_log' ? 'manual_log' : message.sender] ?? 'tone-neutral'}>
                    {messageAuthorLabel(t, message)}
                  </Badge>
                  <span className="text-xs text-muted">{formatTimestamp(message.timestamp)}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-charcoal">{message.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('caseReport.evidence.title')}>
        {report.evidence.length === 0 ? (
          <p className="text-sm text-muted">{t('caseReport.evidence.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {report.evidence.map((item) => (
              <EvidenceRow key={item.fileName ?? item.label} caseId={caseId} item={item} />
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('caseReport.manualLog.title')}>
        {report.manualLogEntries.length === 0 ? (
          <p className="text-sm text-muted">{t('caseReport.manualLog.empty')}</p>
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

      <Card title={t('caseReport.consistencyCheck.title')}>
        {!report.consistencyCheck ? (
          <p className="text-sm text-muted">{t('caseReport.consistencyCheck.empty')}</p>
        ) : (
          <DetailList
            items={[
              [t('caseReport.consistencyCheck.status'), t(`caseDetailView.consistencyStatus.${report.consistencyCheck.status}`, { defaultValue: humanize(report.consistencyCheck.status) })],
              [t('caseReport.consistencyCheck.flag'), report.consistencyCheck.flag?.message ?? t('caseReport.consistencyCheck.none')],
              [t('caseReport.consistencyCheck.typicalAction'), report.consistencyCheck.typicalAction ? t(`actionLabels.${report.consistencyCheck.typicalAction}`, { defaultValue: humanize(report.consistencyCheck.typicalAction) }) : humanize(report.consistencyCheck.typicalAction)],
              [t('caseReport.consistencyCheck.resolutionNotes'), report.consistencyCheck.resolutionNotes],
            ]}
          />
        )}
      </Card>

      <Card title={t('caseReport.policyInEffect.title')} padded={(report.policyInEffect?.length ?? 0) > 0}>
        {!report.policyInEffect || report.policyInEffect.length === 0 ? (
          <p className="text-sm text-muted">{t('caseReport.policyInEffect.empty')}</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {report.policyInEffect.map((policy) => (
              <li key={policy.policyId} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="text-sm text-charcoal">{policy.title ?? t('policyReferences.policyDocument')}</span>
                {policy.version != null && (
                  <span className="text-xs text-muted">{t('policyReferences.version', { version: policy.version })}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('caseReport.finalAction.title')}>
        <DetailList
          items={[
            [
              t('caseReport.finalAction.action'),
              report.finalAction.actionTaken ?? report.finalAction.proposedAction
                ? t(`actionLabels.${report.finalAction.actionTaken ?? report.finalAction.proposedAction}`, {
                    defaultValue: humanize(report.finalAction.actionTaken ?? report.finalAction.proposedAction),
                  })
                : t('caseReport.finalAction.notYetDecided'),
            ],
            [t('caseReport.finalAction.effectiveDate'), formatTimestamp(report.finalAction.actionEffectiveDate)],
            [t('caseReport.finalAction.notes'), report.finalAction.actionNotes],
          ]}
        />
      </Card>

      <Card title={t('caseReport.complianceLog.title')}>
        <DetailList
          items={[
            [t('caseReport.complianceLog.ruleApplied'), report.complianceDeadlineLog.complianceRuleApplied],
            [t('caseReport.complianceLog.acknowledgmentDue'), formatTimestamp(report.complianceDeadlineLog.acknowledgmentDueAt)],
            [t('caseReport.complianceLog.acknowledgmentSent'), formatTimestamp(report.complianceDeadlineLog.acknowledgmentSentAt)],
            [t('caseReport.complianceLog.feedbackDue'), formatTimestamp(report.complianceDeadlineLog.feedbackDueAt)],
            [t('caseReport.complianceLog.feedbackGiven'), formatTimestamp(report.complianceDeadlineLog.feedbackGivenAt)],
          ]}
        />
      </Card>

      <Card
        title={t('caseReport.externalShares.title')}
        description={t('caseReport.externalShares.description')}
      >
        {!report.externalShares || report.externalShares.length === 0 ? (
          <p className="text-sm text-muted">{t('caseReport.externalShares.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {report.externalShares.map((share, index) => (
              <li key={index} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-charcoal">
                    {share.recipientOrganisation ?? t('caseReport.externalShares.unknownOrganisation')}
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
                  {t('caseReport.externalShares.summaryLine', {
                    recipient: share.recipientName,
                    scope: share.scope,
                    created: formatTimestamp(share.createdAt),
                    expires: formatTimestamp(share.expiresAt),
                  })}
                </p>
                <p className="mt-1 text-sm text-charcoal">{share.purpose}</p>
                <p className="mt-1 text-xs text-muted">
                  {t('caseReport.externalShares.accessCount', { count: share.accessCount ?? 0 })}
                  {share.lastAccessedAt ? t('caseReport.externalShares.lastAccessed', { date: formatTimestamp(share.lastAccessedAt) }) : ''}
                  {share.status === 'revoked' && share.revokedReason ? t('caseReport.externalShares.revokedReason', { reason: share.revokedReason }) : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {report.restrictedReporterIdentity && (
        <Card
          title={t('caseReport.restrictedIdentity.title')}
          description={t('caseReport.restrictedIdentity.description')}
          className="border-critical/40"
        >
          {canViewReporterIdentity ? (
            <DetailList
              items={[
                [t('caseReport.restrictedIdentity.status'), report.restrictedReporterIdentity.status],
                [t('caseReport.restrictedIdentity.detailsOnFile'), report.restrictedReporterIdentity.detailsOnFile],
                [t('caseReport.restrictedIdentity.access'), report.restrictedReporterIdentity.access],
                // Present only when the case CHANGED tier mid-investigation -
                // i.e. the reporter filed anonymously and later chose to
                // identify themselves. A case that was confidential from its
                // first message has no such row, and the difference matters to
                // whoever reads this: the early part of the thread was written
                // by someone the investigator could not name.
                ...(report.restrictedReporterIdentity.tierChanged
                  ? [
                      [
                        t('caseReport.restrictedIdentity.identifiedThemselves'),
                        t('caseReport.restrictedIdentity.identifiedThemselvesValue', {
                          date: formatTimestamp(report.restrictedReporterIdentity.tierChanged.at),
                          by: report.restrictedReporterIdentity.tierChanged.by,
                          note: report.restrictedReporterIdentity.tierChanged.note,
                        }),
                      ],
                    ]
                  : []),
              ].filter(([, value]) => value)}
            />
          ) : (
            <Alert variant="error">{t('caseReport.restrictedIdentity.notAuthorized')}</Alert>
          )}
        </Card>
      )}
    </div>
  )
}

export default CaseReport
