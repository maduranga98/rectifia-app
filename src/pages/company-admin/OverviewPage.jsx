import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { getCompanyStats } from '../../services/companyStatsService'
import { assignCompanySlug, getCompany } from '../../services/companyService'
import { listRoutingRules, listStaff } from '../../services/routingService'
import { listPulseSummaries } from '../../services/pulseCheckService'
import { CATEGORIES } from '../../data/categories'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import StatTile from '../../components/ui/StatTile'
import { SkeletonList, SkeletonStats } from '../../components/ui/Loading'

const PRIORITY_TONE = {
  high: 'tone-high',
  medium: 'tone-medium',
  low: 'tone-low',
}

const SENTIMENT_TONE = (score) => {
  if (score === null || score === undefined) return 'tone-neutral'
  if (score < 40) return 'tone-critical'
  if (score < 60) return 'tone-medium'
  return 'tone-low'
}

// The band the average falls in, said in words. The number alone doesn't
// tell a reader whether 58 is good; the badge does, and it uses the same
// thresholds as the colour so the two can never disagree.
const SENTIMENT_LABEL = (score) => {
  if (score === null || score === undefined) return 'no data'
  if (score < 40) return 'needs attention'
  if (score < 60) return 'mixed'
  return 'healthy'
}

const categoryLabelById = new Map(CATEGORIES.map((c) => [c.id, c.label]))

// A labelled count list rendered as a proportional bar rather than a
// label/number pair. With counts this small the bar is what makes the
// distribution readable at a glance - "12 vs 3" lands slower than two bars
// of visibly different length.
function BreakdownList({ entries, labelFor = (key) => key, toneFor = () => 'tone-neutral' }) {
  const max = Math.max(...entries.map(([, count]) => count), 1)

  return (
    <ul className="flex flex-col gap-3">
      {entries.map(([key, count]) => (
        <li key={key} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <Badge tone={toneFor(key)} dot>
              {labelFor(key)}
            </Badge>
            <span className="text-sm font-semibold tabular-nums text-charcoal">{count}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-navy transition-[width] duration-500"
              style={{ width: `${Math.round((count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// The QR half of a ShareableLink - split out so the tracking address below
// can skip it entirely rather than rendering and then hiding it.
function ShareableLinkQr({ url, qrAlt, downloadName }) {
  const [qrDataUrl, setQrDataUrl] = useState(null)

  useEffect(() => {
    if (!url) return undefined
    let active = true
    QRCode.toDataURL(url, { width: 256, margin: 1 })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (active) setQrDataUrl(null)
      })
    return () => {
      active = false
    }
  }, [url])

  return (
    <div className="shrink-0">
      {qrDataUrl ? (
        <>
          <img
            src={qrDataUrl}
            alt={qrAlt}
            className="h-40 w-40 rounded-lg border border-line bg-white p-2"
          />
          <a
            href={qrDataUrl}
            download={downloadName}
            className="btn btn-secondary mt-2 flex w-40 justify-center"
          >
            Download QR
          </a>
        </>
      ) : (
        <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-line bg-line-soft text-xs text-muted">
          Generating…
        </div>
      )}
    </div>
  )
}

// One shareable address: the literal URL plus a copy button, and a QR code
// beside it, generated client-side from the current origin so it points at
// wherever the app is actually served (localhost in dev, the real domain in
// production) rather than a hard-coded host.
function ShareableLink({ heading, description, url, qrAlt, downloadName }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be unavailable (insecure context / denied permission);
      // the link stays visible and selectable below either way.
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <ShareableLinkQr url={url} qrAlt={qrAlt} downloadName={downloadName} />
      <div className="flex min-w-0 flex-col gap-2">
        <h4 className="text-sm font-semibold text-charcoal">{heading}</h4>
        <p className="text-sm text-muted">{description}</p>
        <code className="block select-all break-all rounded-md border border-line bg-line-soft px-3 py-2 text-xs text-charcoal">
          {url}
        </code>
        <div className="flex flex-wrap gap-2">
          <Button onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Button>
        </div>
      </div>
    </div>
  )
}

// The printable/postable reporting address for this company: the public
// /submit/:companySlug URL an anonymous reporter follows - the same slug the
// Submit page resolves server-side. Nothing here is case content; it's the
// company's own public address rendered as a QR.
//
// The case-tracking address (/case) deliberately isn't posted here - it's
// not company-scoped (every company shares the same URL, keyed by the Case
// ID and passcode the reporter holds), so a poster meant to be scanned by
// this company's employees is the wrong place for it. A reporter reaches it
// instead from the "Track an existing case" control on every reporter-facing
// screen (ReporterLayout.jsx) and from the Case ID/passcode screen shown once
// at submission.
//
// A company with no slug isn't stuck waiting on a backfill: this role can
// allocate one here. The allocation itself is the same platform-wide-unique
// function company creation uses (companyService.assignCompanySlug ->
// allocateUniqueSlug), and firestore.rules lets only this company's Company
// Admin write the field, so the button is a convenience on top of a
// server-enforced permission rather than the thing granting it.
function ReportingLinkCard({ company, onSlugGenerated }) {
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState(null)

  const slug = company?.slug
  const origin = typeof window !== 'undefined' ? window.location.origin : null

  const submitUrl = slug && origin ? `${origin}/submit/${slug}` : null

  async function generateLink() {
    if (!company?.id || generating) return
    setGenerating(true)
    setGenerateError(null)
    try {
      await assignCompanySlug(company.id, company.name)
      // Re-fetch through the page's own loader rather than patching local
      // state, so the card renders the slug that is actually on the document.
      await onSlugGenerated?.()
    } catch (err) {
      setGenerateError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card title="Reporting links">
      {!slug ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">
            This company doesn&apos;t have a reporting link yet. Generating one creates the
            public address employees use to file confidential reports - it can only be
            created once, and stays the same afterwards.
          </p>
          {generateError && <Alert variant="error">{generateError}</Alert>}
          <Button
            variant="primary"
            onClick={generateLink}
            loading={generating}
            loadingLabel="Generating"
            disabled={!company?.id}
          >
            Generate reporting link
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-muted">
            Print or post the QR below to invite reports - it&apos;s the only one meant for a
            poster. It requires no login and no name.
          </p>

          <ShareableLink
            heading="File a report"
            description="Opens the confidential intake form for your company. Anyone with this link can file - no login, no name required."
            url={submitUrl}
            qrAlt="QR code linking to the confidential reporting form for this company"
            downloadName="reporting-qr.png"
          />
        </div>
      )}
    </Card>
  )
}

function SectionHeading({ children, hint }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  )
}

// Company Admin's overview (module 15). Three data sources, each already
// scoped to what this role is allowed to see per firestore.rules:
// - companies/{companyId}/stats/overview - count-only case rollup, no case
//   ids or content (functions/src/company/syncCompanyStats.js).
// - companies/{companyId}/staff and routingRules - settings this role already
//   owned before this page existed.
// - pulseSummaries - department/period aggregates with no individual
//   attribution, the same collection the Manager role reads; this role has
//   no path to the underlying pulseResponses.
// Still no read path anywhere here to cases/, messages/, or caseMetadata/.
function OverviewPage({ companyId }) {
  const [stats, setStats] = useState(null)
  const [staff, setStaff] = useState([])
  const [routingRules, setRoutingRules] = useState([])
  const [pulseSummaries, setPulseSummaries] = useState([])
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRow, staffRows, routingRows, pulseRows, companyRow] = await Promise.all([
        getCompanyStats(companyId),
        listStaff(companyId),
        listRoutingRules(companyId),
        listPulseSummaries(companyId),
        getCompany(companyId),
      ])
      setStats(statsRow)
      setStaff(staffRows)
      setRoutingRules(routingRows)
      setPulseSummaries(pulseRows)
      setCompany(companyRow)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const staffNameById = useMemo(() => {
    const map = new Map()
    staff.forEach((s) => map.set(s.id, s.email ?? s.id))
    return map
  }, [staff])

  const activeStaffCount = staff.filter((s) => (s.status ?? 'active') !== 'suspended').length
  const caseHandlerCount = staff.filter((s) => s.role === 'caseHandler').length

  const priorityEntries = Object.entries(stats?.byPriority ?? {}).sort(([, a], [, b]) => b - a)
  const categoryEntries = Object.entries(stats?.byCategory ?? {}).sort(([, a], [, b]) => b - a)
  const handlerEntries = Object.entries(stats?.byHandler ?? {}).sort(([, a], [, b]) => b - a)

  const firstLoad = loading && !stats && staff.length === 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">
          Aggregate case activity, staffing, and wellbeing signals for your company. Case
          content itself is never shown to this role - only counts.
        </p>
        <Button icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
          Refresh
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {/* Persistent while crisisContact is unset: a crisis-flagged report
          bypasses normal routing and notifies this contact directly, so with
          none configured the highest-severity path silently reaches no one.
          Only shown once the company doc has loaded, so it never flashes during
          the initial fetch. */}
      {!firstLoad && company && !company.crisisContact && (
        <Alert variant="warning" title="No crisis contact configured">
          Reports flagged with crisis language currently have no recipient — the notification is
          generated but reaches no one. Set a named crisis contact on the{' '}
          <Link to="/admin/settings" className="font-medium underline">
            Settings
          </Link>{' '}
          page.
        </Alert>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeading hint="Share these QR codes or links so employees can file confidential reports - and find their way back to one they already filed.">
          Reporting links
        </SectionHeading>
        {firstLoad ? (
          <SkeletonList rows={1} />
        ) : (
          <ReportingLinkCard company={company} onSlugGenerated={refresh} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading hint="Counts only, updated as cases move through their lifecycle.">
          Case overview
        </SectionHeading>

        {firstLoad ? (
          <SkeletonStats />
        ) : !stats ? (
          <Card padded={false}>
            <EmptyState
              icon="cases"
              title="No case activity yet"
              description="Once the first report is submitted, open, closed, and overdue counts appear here."
            />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Open cases" value={stats.openCount ?? 0} tone="tone-info" icon="cases" />
              <StatTile label="Closed cases" value={stats.closedCount ?? 0} tone="tone-neutral" icon="check" />
              <StatTile
                label="Overdue deadlines"
                value={stats.overdueCount ?? 0}
                tone={stats.overdueCount > 0 ? 'tone-critical' : 'tone-neutral'}
                icon="alert"
              />
              <StatTile
                label="Approaching deadlines"
                hint="Due within 48 hours"
                value={stats.approachingDeadlineCount ?? 0}
                tone={stats.approachingDeadlineCount > 0 ? 'tone-high' : 'tone-neutral'}
                icon="clock"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Open cases by priority">
                {priorityEntries.length === 0 ? (
                  <p className="text-sm text-muted">No open cases.</p>
                ) : (
                  <BreakdownList
                    entries={priorityEntries}
                    toneFor={(key) => PRIORITY_TONE[key] ?? 'tone-neutral'}
                  />
                )}
              </Card>
              <Card title="Cases by category">
                {categoryEntries.length === 0 ? (
                  <p className="text-sm text-muted">No cases yet.</p>
                ) : (
                  <BreakdownList
                    entries={categoryEntries}
                    labelFor={(key) => categoryLabelById.get(key) ?? key}
                  />
                )}
              </Card>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading hint="Who is available to take cases, and how they get assigned.">
          Staff &amp; routing
        </SectionHeading>

        {firstLoad ? (
          <SkeletonStats count={3} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Active staff" value={activeStaffCount} tone="tone-info" icon="staff" />
              <StatTile label="Case handlers" value={caseHandlerCount} tone="tone-neutral" icon="shield" />
              <StatTile
                label="Routing rules"
                hint="Category and department mappings"
                value={routingRules.length}
                tone={routingRules.length === 0 ? 'tone-high' : 'tone-neutral'}
                icon="routing"
              />
            </div>

            <Card title="Open cases by handler" padded={handlerEntries.length > 0}>
              {handlerEntries.length === 0 ? (
                <EmptyState
                  compact
                  icon="staff"
                  title="No open cases assigned"
                  description="Assigned workload per handler shows up here as cases come in."
                />
              ) : (
                <BreakdownList
                  entries={handlerEntries}
                  labelFor={(key) => staffNameById.get(key) ?? key}
                />
              )}
            </Card>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading hint="Department and period averages - never an individual response.">
          Pulse check sentiment
        </SectionHeading>

        {firstLoad ? (
          <SkeletonList rows={2} />
        ) : pulseSummaries.length === 0 ? (
          // Departments below the minimum-response privacy floor are withheld
          // server-side, so an empty result means either no responses yet or
          // none of them has reached the threshold. Either way the message
          // names the floor instead of implying there is no data, and shows no
          // counts - a count would itself reveal how few people responded.
          <Card padded={false}>
            <EmptyState
              icon="pulse"
              title="Not enough responses yet to show a summary"
              description="Department sentiment averages appear once enough people in a department have responded. Below that minimum, no average is shown, so it can never stand in for one person's answer."
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pulseSummaries.map((s) => (
              <Card key={s.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-charcoal">
                      {s.department ?? 'Unspecified department'}
                    </p>
                    <p className="text-xs text-muted">{s.period}</p>
                  </div>
                  <Badge tone={SENTIMENT_TONE(s.averageSentiment)} dot>
                    {SENTIMENT_LABEL(s.averageSentiment)}
                  </Badge>
                </div>
                <p className="mt-3 text-3xl font-semibold tabular-nums text-charcoal">
                  {s.averageSentiment ?? '-'}
                </p>
                <p className="text-xs text-muted">
                  avg. sentiment across {s.responseCount} response{s.responseCount === 1 ? '' : 's'}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default OverviewPage
