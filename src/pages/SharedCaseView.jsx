import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getSharedCase, getSharedEvidenceDownloadUrl, SCOPE_LABELS } from '../services/shareService'
import Alert from '../components/ui/Alert'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Field'

function formatTimestamp(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function humanize(value) {
  return typeof value === 'string' ? value.replace(/_/g, ' ') : value
}

// Repeated, rotated watermark text tiled across the whole viewport, above
// every panel and never covered by scrolling content (position: fixed).
// pointer-events: none so it never intercepts a click on the real content
// beneath it - it is meant to be seen and screenshotted, not interacted
// with. The timestamp updates once a second (see the `now` state in the
// parent), so a screenshot cannot be taken of a watermark frozen in the
// past: whatever moment the screenshot was taken at is baked into the image.
function Watermark({ recipientName, recipientOrganisation, now }) {
  const { t } = useTranslation()
  const label = `${recipientName ?? t('sharedCaseView.watermark.unknownRecipient')} · ${
    recipientOrganisation ?? t('sharedCaseView.watermark.unknownOrganisation')
  } · ${new Date(now).toLocaleString()}`

  // A generous grid, not one centred stamp - a screenshot cropped to any
  // corner of the screen should still carry attribution.
  const tiles = Array.from({ length: 42 })

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden select-none"
      style={{ userSelect: 'none' }}
    >
      <div className="grid h-[200vh] w-[200vw] -translate-x-1/4 -translate-y-1/4 grid-cols-6 gap-16 opacity-[0.09]">
        {tiles.map((_, i) => (
          <span
            key={i}
            className="whitespace-nowrap text-sm font-semibold text-charcoal"
            style={{ transform: 'rotate(-32deg)' }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-charcoal">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function DetailList({ items }) {
  const { t } = useTranslation()
  const filtered = items.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (filtered.length === 0) return <p className="text-sm text-muted">{t('sharedCaseView.nothingOnFile')}</p>
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {filtered.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-[0.04em] text-muted">{label}</dt>
          <dd className="mt-0.5 text-sm text-charcoal">{String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

// Opens one evidence file already in this share's frozen allowlist. Mints a
// fresh, short-lived signed URL on click and never stores it - the same
// discipline CaseThread.jsx's AttachmentLink and CaseEvidencePanel.jsx's
// OpenAction use internally, extended out to this unauthenticated view.
function EvidenceOpenAction({ shareId, token, fileName }) {
  const { t } = useTranslation()
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  async function open() {
    setOpening(true)
    setFailed(false)
    try {
      const url = await getSharedEvidenceDownloadUrl(shareId, token, fileName)
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
    <div className="mt-1.5 flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size="sm"
        icon="document"
        onClick={open}
        loading={opening}
        loadingLabel={t('sharedCaseView.evidence.opening')}
      >
        {t('sharedCaseView.evidence.open')}
      </Button>
      {failed && <span className="text-xs text-critical">{t('sharedCaseView.evidence.openFailed')}</span>}
    </div>
  )
}

const SENDER_TONE = {
  Reporter: 'tone-neutral',
  'Case Handler': 'tone-info',
  'AI assistant': 'tone-info',
}

function AcceptanceGate({ onAccept, submitting, error }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const canSubmit = name.trim().length >= 2 && agreed && !submitting

  function handleSubmit(event) {
    event.preventDefault()
    if (!canSubmit) return
    onAccept(name.trim())
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-5 py-12">
      <div>
        <h1 className="text-lg font-semibold text-charcoal">{t('sharedCaseView.acceptance.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('sharedCaseView.acceptance.description')}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
        <Input
          label={t('sharedCaseView.acceptance.fullName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label className="flex items-start gap-2 text-sm text-charcoal">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          {/* The undertaking a recipient accepts on first access. Recorded
              verbatim as the fact of acceptance (acceptedName + acceptedAt on
              the share document) - the text itself is not stored
              per-acceptance, since it is fixed and unconfigurable here, the
              same way renderReportPdf.js's classification banner is fixed
              rather than a per-company setting. */}
          <span>{t('sharedCaseView.acceptance.undertakingText')}</span>
        </label>
        {error && <Alert variant="error">{error}</Alert>}
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          loadingLabel={t('sharedCaseView.acceptance.confirming')}
          disabled={!canSubmit}
        >
          {t('sharedCaseView.acceptance.acceptAndContinue')}
        </Button>
      </form>
    </div>
  )
}

// Standalone route (/shared/:shareId), reached with no Firebase Auth session
// and no reporter passcode - the token in the URL's query string is the
// entire credential. Deliberately not built on AppShell or ReporterLayout:
// no logo linking anywhere, no nav, no "track a case" link, nothing that
// invites navigation into the rest of the product. A recipient of this link
// should be able to do exactly one thing from this page: read the one case
// they were given access to.
function SharedCaseView() {
  const { t } = useTranslation()
  const { shareId } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [requiresAcceptance, setRequiresAcceptance] = useState(false)
  const [acceptSubmitting, setAcceptSubmitting] = useState(false)
  const [acceptError, setAcceptError] = useState(null)
  const [data, setData] = useState(null)
  // Seeded to null rather than Date.now() - reading the clock during render
  // is an impure render, and the watermark does not need a value before the
  // first tick sets one a moment later.
  const [now, setNow] = useState(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Printing is disabled two ways: CSS below hides the real content and
  // shows a fixed notice instead for @media print, and this listener is a
  // second, client-visible signal that an attempt happened - it cannot
  // cancel the browser's print dialog (no web API can), so the CSS swap is
  // the actual control, not this listener.
  useEffect(() => {
    function handleBeforePrint() {
      window.alert(t('sharedCaseView.printDisabledAlert'))
    }
    window.addEventListener('beforeprint', handleBeforePrint)
    return () => window.removeEventListener('beforeprint', handleBeforePrint)
  }, [t])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await getSharedCase({ shareId, token })
        if (cancelled) return
        if (result.requiresAcceptance) {
          setRequiresAcceptance(true)
        } else {
          setData(result)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (shareId && token) {
      load()
    } else {
      setError(t('sharedCaseView.errors.missingInfo'))
      setLoading(false)
    }
    return () => {
      cancelled = true
    }
  }, [shareId, token, t])

  async function handleAccept(acceptedName) {
    setAcceptSubmitting(true)
    setAcceptError(null)
    try {
      const result = await getSharedCase({ shareId, token, acceptedName })
      if (result.requiresAcceptance) {
        // Should not happen once a valid name was sent, but fail safely.
        setAcceptError(t('sharedCaseView.errors.acceptanceFailed'))
        return
      }
      setData(result)
      setRequiresAcceptance(false)
    } catch (err) {
      setAcceptError(err.message)
    } finally {
      setAcceptSubmitting(false)
    }
  }

  const expiresLabel = useMemo(() => (data ? formatTimestamp(data.expiresAt) : null), [data])

  return (
    <div
      className="min-h-screen bg-navy-50/40 print:bg-white"
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <style>{`
        @media print {
          .shared-case-printable { display: none !important; }
          .shared-case-print-notice { display: flex !important; }
        }
        .shared-case-print-notice { display: none; }
      `}</style>

      <div className="shared-case-print-notice min-h-screen items-center justify-center p-8 text-center">
        <p className="text-lg font-semibold text-charcoal">{t('sharedCaseView.printDisabledNotice')}</p>
      </div>

      <div className="shared-case-printable">
        {data && (
          <Watermark recipientName={data.recipientName} recipientOrganisation={data.recipientOrganisation} now={now} />
        )}

        {loading && (
          <div className="flex min-h-screen items-center justify-center">
            <p className="text-sm text-muted">{t('common.loading')}</p>
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
            <h1 className="text-lg font-semibold text-charcoal">{t('sharedCaseView.linkInvalid.title')}</h1>
            <p className="text-sm text-muted">{error}</p>
          </div>
        )}

        {!loading && !error && requiresAcceptance && (
          <AcceptanceGate onAccept={handleAccept} submitting={acceptSubmitting} error={acceptError} />
        )}

        {!loading && !error && !requiresAcceptance && data && (
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
            {/* Persistent banner - what this is, who shared it, when it expires.
                Sticky so it stays visible while scrolling a long record. */}
            <div className="sticky top-3 z-40 rounded-xl border border-gold/50 bg-gold-50 px-4 py-3 shadow-sm">
              <p className="text-sm font-semibold text-charcoal">
                {t('sharedCaseView.banner.title', {
                  company: data.companyName ?? t('sharedCaseView.banner.defaultOrganisation'),
                })}
              </p>
              <p className="mt-0.5 text-xs text-charcoal">
                {t('sharedCaseView.banner.details', {
                  sharedBy: data.sharedByEmail ?? t('sharedCaseView.banner.defaultHandler'),
                  scope: SCOPE_LABELS[data.scope] ?? data.scope,
                  expires: expiresLabel,
                })}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {t('sharedCaseView.banner.viewingAs', {
                  name: data.recipientName,
                  organisation: data.recipientOrganisation,
                })}
              </p>
            </div>

            <div>
              <h1 className="text-xl font-semibold text-charcoal">{t('sharedCaseView.caseHeading', { caseId: data.caseId })}</h1>
              {data.purpose && (
                <p className="mt-1 text-sm text-muted">{t('sharedCaseView.purpose', { purpose: data.purpose })}</p>
              )}
            </div>

            <Section title={t('sharedCaseView.sections.summary.title')}>
              <DetailList
                items={[
                  [t('sharedCaseView.sections.summary.category'), humanize(data.summary?.category)],
                  [t('sharedCaseView.sections.summary.status'), humanize(data.summary?.status)],
                  [t('sharedCaseView.sections.summary.priority'), humanize(data.summary?.priority)],
                  [t('sharedCaseView.sections.summary.severityScore'), data.summary?.severityScore],
                  [t('sharedCaseView.sections.summary.evidenceScore'), data.summary?.evidenceScore],
                  [t('sharedCaseView.sections.summary.opened'), formatTimestamp(data.summary?.createdAt)],
                  [t('sharedCaseView.sections.summary.closed'), formatTimestamp(data.summary?.closedAt)],
                ]}
              />
            </Section>

            <Section title={t('sharedCaseView.sections.finalAction.title')}>
              <DetailList
                items={[
                  [
                    t('sharedCaseView.sections.finalAction.action'),
                    humanize(data.finalAction?.actionTaken ?? data.finalAction?.proposedAction) ||
                      t('sharedCaseView.sections.finalAction.notYetDecided'),
                  ],
                  [t('sharedCaseView.sections.finalAction.effectiveDate'), formatTimestamp(data.finalAction?.actionEffectiveDate)],
                  [t('sharedCaseView.sections.finalAction.notes'), data.finalAction?.actionNotes],
                ]}
              />
            </Section>

            <Section title={t('sharedCaseView.sections.complianceLog.title')}>
              <DetailList
                items={[
                  [t('sharedCaseView.sections.complianceLog.ruleApplied'), data.complianceLog?.complianceRuleApplied],
                  [t('sharedCaseView.sections.complianceLog.acknowledgmentDue'), formatTimestamp(data.complianceLog?.acknowledgmentDueAt)],
                  [t('sharedCaseView.sections.complianceLog.acknowledgmentSent'), formatTimestamp(data.complianceLog?.acknowledgmentSentAt)],
                  [t('sharedCaseView.sections.complianceLog.feedbackDue'), formatTimestamp(data.complianceLog?.feedbackDueAt)],
                  [t('sharedCaseView.sections.complianceLog.feedbackGiven'), formatTimestamp(data.complianceLog?.feedbackGivenAt)],
                ]}
              />
            </Section>

            {Array.isArray(data.questionnaire) && (
              <Section title={t('sharedCaseView.sections.questionnaire.title')}>
                {data.questionnaire.length === 0 ? (
                  <p className="text-sm text-muted">{t('sharedCaseView.sections.questionnaire.empty')}</p>
                ) : (
                  <DetailList
                    items={data.questionnaire.map((entry) => [
                      entry.questionText ?? entry.questionId,
                      Array.isArray(entry.answer) ? entry.answer.join(', ') : entry.answer,
                    ])}
                  />
                )}
              </Section>
            )}

            {Array.isArray(data.timeline) && (
              <Section
                title={t('sharedCaseView.sections.timeline.title')}
                description={t('sharedCaseView.sections.timeline.description')}
              >
                {data.timeline.length === 0 ? (
                  <p className="text-sm text-muted">{t('sharedCaseView.sections.timeline.empty')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line-soft">
                    {data.timeline.map((message, index) => (
                      <li key={index} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-3">
                          <Badge tone={SENDER_TONE[message.sender] ?? 'tone-neutral'}>{message.sender}</Badge>
                          <span className="text-xs text-muted">{formatTimestamp(message.timestamp)}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-charcoal">{message.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            <Section
              title={t('sharedCaseView.sections.evidence.title')}
              description={t('sharedCaseView.sections.evidence.description')}
            >
              {!data.evidence || data.evidence.length === 0 ? (
                <p className="text-sm text-muted">{t('sharedCaseView.sections.evidence.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {data.evidence.map((item, index) => (
                    <li key={index} className="rounded-lg border border-line px-3 py-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-charcoal">{item.label}</p>
                        {!item.shared && <Badge tone="tone-neutral">{t('sharedCaseView.sections.evidence.notShared')}</Badge>}
                      </div>
                      <p className="text-xs text-muted">
                        {item.contentType ?? t('sharedCaseView.sections.evidence.unknownType')} ·{' '}
                        {item.sizeBytes ? `${Math.round(item.sizeBytes / 1024)} KB` : '—'} ·{' '}
                        {formatTimestamp(item.uploadedAt)}
                      </p>
                      {item.shared && (
                        <EvidenceOpenAction shareId={shareId} token={token} fileName={item.fileName} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <p className="pb-8 text-center text-xs text-muted">{t('sharedCaseView.footer')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default SharedCaseView
