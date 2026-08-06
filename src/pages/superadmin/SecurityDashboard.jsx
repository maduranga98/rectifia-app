import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getSecurityDashboard,
  getAccessReviewForAttestation,
  attestAccessReview,
  recordKeyRotation,
  reviewSecurityAlert,
  attestRestoreTest,
  ALERT_SEVERITY_TONE,
  ALERT_TYPE_LABELS,
} from '../../services/securityService'
import { signOutUser } from '../../services/authService'
import { useAuth } from '../../contexts/AuthContext'
import AppShell from '../../components/shared/AppShell'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import StatTile from '../../components/ui/StatTile'
import { Input, Textarea } from '../../components/ui/Field'
import { SkeletonList, SkeletonStats } from '../../components/ui/Loading'

function formatDate(ms) {
  if (!ms) return 'never'
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// One open alert row. Reviewing it is the one mutation this screen makes to
// an alert - it records that a human looked, never that anything about the
// account or case behind it changed. See reviewSecurityAlert's own comment
// in functions/src/security/anomalyDetection.js.
function AlertRow({ alert, onReviewed }) {
  const [reviewing, setReviewing] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleReview() {
    setSaving(true)
    setError(null)
    try {
      await reviewSecurityAlert(alert.id, note)
      onReviewed(alert.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={ALERT_SEVERITY_TONE[alert.severity] ?? 'tone-neutral'} dot>
              {alert.severity ?? 'unknown'}
            </Badge>
            <p className="text-sm font-medium text-charcoal">
              {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
            </p>
          </div>
          <p className="mt-1 text-sm text-charcoal">{alert.summary}</p>
          <p className="mt-1 text-xs text-muted">
            Detected {formatDate(alert.detectedAt)}
            {alert.companyId ? ` · company ${alert.companyId}` : ''}
            {alert.actorUid ? ` · actor ${alert.actorUid}` : ''}
          </p>
        </div>
        {!reviewing && (
          <Button variant="ghost" size="sm" onClick={() => setReviewing(true)}>
            Mark reviewed
          </Button>
        )}
      </div>

      {reviewing && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          {error && <Alert variant="error">{error}</Alert>}
          <Textarea
            label="Review note (optional)"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={saving} loadingLabel="Saving" onClick={handleReview}>
              Confirm reviewed
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReviewing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// One pending quarterly access review. Expanding it loads the full account
// roster (getAccessReviewForAttestation - the review collection itself has no
// client read path; see firestore.rules) and lets a Company Admin record a
// keep/revoke decision per account before attesting the whole review at once.
function AccessReviewRow({ summary, onAttested }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [review, setReview] = useState(null)
  const [decisions, setDecisions] = useState({})
  const [submitting, setSubmitting] = useState(false)

  async function handleExpand() {
    setExpanded(true)
    if (review) return
    setLoading(true)
    setError(null)
    try {
      const data = await getAccessReviewForAttestation(summary.reviewId)
      setReview(data)
      setDecisions(Object.fromEntries(data.accounts.map((a) => [a.uid, 'keep'])))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAttest() {
    setSubmitting(true)
    setError(null)
    try {
      const decisionList = Object.entries(decisions).map(([uid, decision]) => ({ uid, decision }))
      await attestAccessReview(summary.reviewId, decisionList)
      onAttested(summary.reviewId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal">
            {summary.companyId} · {summary.period}
          </p>
          <p className="text-xs text-muted">
            {summary.accountCount} account{summary.accountCount === 1 ? '' : 's'}, {summary.dormantCount} dormant ·
            generated {formatDate(summary.generatedAt)}
          </p>
        </div>
        {!expanded && (
          <Button variant="secondary" size="sm" onClick={handleExpand}>
            Review &amp; attest
          </Button>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
          {error && <Alert variant="error">{error}</Alert>}
          {loading && <SkeletonList rows={2} />}
          {review && (
            <>
              <div className="flex flex-col divide-y divide-line-soft">
                {review.accounts.map((account) => (
                  <div key={account.uid} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-charcoal">
                        {account.email ?? account.uid} <span className="text-muted">· {account.role}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {account.dormant ? 'Dormant · ' : ''}
                        last login {formatDate(account.lastLoginAt)}
                        {!account.authAccountFound ? ' · no matching Auth account' : ''}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant={decisions[account.uid] === 'keep' ? 'primary' : 'ghost'}
                        size="sm"
                        onClick={() => setDecisions((d) => ({ ...d, [account.uid]: 'keep' }))}
                      >
                        Keep
                      </Button>
                      <Button
                        variant={decisions[account.uid] === 'revoke' ? 'danger' : 'ghost'}
                        size="sm"
                        onClick={() => setDecisions((d) => ({ ...d, [account.uid]: 'revoke' }))}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">
                "Revoke" records your decision only - it does not deactivate the account. Deactivate a
                revoked account from the company's Staff page.
              </p>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" loading={submitting} loadingLabel="Attesting" onClick={handleAttest}>
                  Attest this review
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setExpanded(false)} disabled={submitting}>
                  Collapse
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function KeyAgeRow({ keyAge, onRecorded }) {
  const [recording, setRecording] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleRecord() {
    setSaving(true)
    setError(null)
    try {
      await recordKeyRotation(keyAge.keyId, note)
      setNote('')
      setRecording(false)
      onRecorded()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-charcoal">{keyAge.label}</p>
          <p className="text-xs text-muted">
            {keyAge.ageDays === null ? 'age unknown' : `${keyAge.ageDays} days old`}
            {keyAge.thresholdDays ? ` · threshold ${keyAge.thresholdDays} days` : ''} · last checked{' '}
            {formatDate(keyAge.lastCheckedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {keyAge.overThreshold && (
            <Badge tone="tone-critical" dot>
              Rotation overdue
            </Badge>
          )}
          {!recording && (
            <Button variant="ghost" size="sm" onClick={() => setRecording(true)}>
              Record rotation
            </Button>
          )}
        </div>
      </div>
      {recording && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          {error && <Alert variant="error">{error}</Alert>}
          <p className="text-xs text-muted">
            Only record this after actually rotating {keyAge.label} in Secret Manager and redeploying.
          </p>
          <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={saving} loadingLabel="Recording" onClick={handleRecord}>
              Confirm rotated
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRecording(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

const CONTROL_LABELS = {
  accessReview: 'Access review (quarterly)',
  keyRotation: 'Key rotation check (weekly)',
  anomalyDetection: 'Anomaly detection (daily)',
  integrityCheck: 'Integrity check (weekly)',
  backupVerification: 'Backup verification (monthly)',
}

// The single screen you screenshot for an auditor (module 26): open alerts,
// pending access reviews, key ages, last verified backup, and when every
// scheduled control last ran - one callable (getSecurityDashboard), because
// every collection behind it is sealed to direct client reads.
function SecurityDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [restoreOutcome, setRestoreOutcome] = useState('passed')
  const [restoreNotes, setRestoreNotes] = useState('')
  const [attestingRestore, setAttestingRestore] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getSecurityDashboard())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleSignOut() {
    await signOutUser()
    navigate('/super-admin/login', { replace: true })
  }

  function dismissAlert(alertId) {
    setData((d) => ({
      ...d,
      openAlerts: d.openAlerts.filter((a) => a.id !== alertId),
      openAlertCount: d.openAlertCount - 1,
    }))
    setNotice('Alert marked reviewed.')
  }

  function dismissReview(reviewId) {
    setData((d) => ({
      ...d,
      pendingAccessReviews: d.pendingAccessReviews.filter((r) => r.reviewId !== reviewId),
      pendingAccessReviewCount: d.pendingAccessReviewCount - 1,
    }))
    setNotice('Access review attested.')
  }

  async function handleAttestRestore() {
    setAttestingRestore(true)
    setError(null)
    try {
      await attestRestoreTest(restoreOutcome, restoreNotes)
      setRestoreNotes('')
      setNotice('Restore test attestation recorded.')
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setAttestingRestore(false)
    }
  }

  const overdueKeyCount = data?.keyAges?.filter((k) => k.overThreshold).length ?? 0
  const backup = data?.lastBackup ?? null

  return (
    <AppShell
      scopeLabel="Lumora platform"
      navItems={[
        { id: 'companies', label: 'Companies', icon: 'company', to: '/super-admin' },
        { id: 'manualAssignment', label: 'Manual assignment', icon: 'routing', to: '/super-admin?section=manualAssignment' },
        { id: 'security', label: 'Security', icon: 'shield', to: '/super-admin/security' },
      ]}
      activeId="security"
      userEmail={user?.email}
      roleLabel="Super Admin"
      onSignOut={handleSignOut}
      eyebrow="Platform administration"
      title="Security dashboard"
      headerActions={
        <Button variant="secondary" icon="refresh" onClick={refresh} loading={loading} loadingLabel="Refreshing">
          Refresh
        </Button>
      }
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {error && <Alert variant="error">{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}

        {loading && !data ? (
          <SkeletonStats />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Open alerts"
              value={data?.openAlertCount ?? 0}
              tone={data?.openAlertCount > 0 ? 'tone-critical' : 'tone-low'}
              icon="alert"
            />
            <StatTile
              label="Pending access reviews"
              value={data?.pendingAccessReviewCount ?? 0}
              tone={data?.pendingAccessReviewCount > 0 ? 'tone-high' : 'tone-low'}
              icon="staff"
            />
            <StatTile
              label="Keys overdue for rotation"
              value={overdueKeyCount}
              tone={overdueKeyCount > 0 ? 'tone-critical' : 'tone-low'}
              icon="settings"
            />
            <StatTile
              label="Backup status"
              value={backup ? (backup.exportStale ? 'Stale' : 'Verified') : 'Unknown'}
              tone={!backup || backup.exportStale ? 'tone-critical' : 'tone-low'}
              icon="shield"
              hint={backup ? `Period ${backup.period}` : 'No run recorded yet'}
            />
          </div>
        )}

        <Card
          title="Open alerts"
          description="Advisory only - nothing here revokes access, deletes data, or blocks a user automatically."
        >
          {loading && !data ? (
            <SkeletonList rows={2} />
          ) : !data?.openAlerts?.length ? (
            <EmptyState compact icon="check" title="No open alerts" />
          ) : (
            <div className="flex flex-col divide-y divide-line-soft">
              {data.openAlerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} onReviewed={dismissAlert} />
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Pending access reviews"
          description="CC6.2 / CC6.3: every staff account, role, last login, and dormancy, compiled quarterly and awaiting a Company Admin's keep/revoke attestation."
        >
          {loading && !data ? (
            <SkeletonList rows={2} />
          ) : !data?.pendingAccessReviews?.length ? (
            <EmptyState compact icon="staff" title="No access reviews awaiting attestation" />
          ) : (
            <div className="flex flex-col divide-y divide-line-soft">
              {data.pendingAccessReviews.map((review) => (
                <AccessReviewRow key={review.reviewId} summary={review} onAttested={dismissReview} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Key ages" description="IDENTITY_VAULT_ENCRYPTION_KEY, VAPID keys, and the Anthropic API key.">
          {loading && !data ? (
            <SkeletonList rows={2} />
          ) : (
            <div className="flex flex-col divide-y divide-line-soft">
              {data?.keyAges?.map((keyAge) => (
                <KeyAgeRow key={keyAge.keyId} keyAge={keyAge} onRecorded={refresh} />
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Backup verification"
          description="Confirms the most recent Firestore export exists and is readable. A backup never test-restored is not a verified backup."
        >
          {loading && !data ? (
            <SkeletonList rows={1} />
          ) : !backup ? (
            <EmptyState compact icon="shield" title="No backup verification has run yet" />
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Period</dt>
                  <dd className="mt-0.5 font-medium text-charcoal">{backup.period}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Export found</dt>
                  <dd className="mt-0.5 font-medium text-charcoal">{backup.exportFound ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Export readable</dt>
                  <dd className="mt-0.5 font-medium text-charcoal">{backup.exportReadable ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Exported at</dt>
                  <dd className="mt-0.5 font-medium text-charcoal">{formatDate(backup.exportedAt)}</dd>
                </div>
              </dl>

              {backup.restoreTestAttestation ? (
                <Alert variant={backup.restoreTestAttestation.outcome === 'passed' ? 'success' : 'error'}>
                  Last restore test {backup.restoreTestAttestation.outcome} on{' '}
                  {formatDate(backup.restoreTestAttestation.attestedAt)} by{' '}
                  {backup.restoreTestAttestation.attestedByUid}.
                </Alert>
              ) : (
                <Alert variant="warning">No restore test has been attested yet.</Alert>
              )}

              <div className="rounded-lg border border-line p-3">
                <p className="mb-2 text-sm font-medium text-charcoal">Attest a restore test</p>
                <p className="mb-3 text-xs text-muted">
                  Only submit this after actually performing a restore-from-backup drill.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex gap-1">
                    <Button
                      variant={restoreOutcome === 'passed' ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => setRestoreOutcome('passed')}
                    >
                      Passed
                    </Button>
                    <Button
                      variant={restoreOutcome === 'failed' ? 'danger' : 'ghost'}
                      size="sm"
                      onClick={() => setRestoreOutcome('failed')}
                    >
                      Failed
                    </Button>
                  </div>
                  <div className="min-w-[220px] flex-1">
                    <Input
                      label="Notes"
                      value={restoreNotes}
                      onChange={(e) => setRestoreNotes(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={attestingRestore}
                    loadingLabel="Recording"
                    onClick={handleAttestRestore}
                  >
                    Submit attestation
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Control runs"
          description="Every scheduled control writes a run record even when it finds nothing - this is what tells the difference between a clean run and a broken job."
        >
          {loading && !data ? (
            <SkeletonList rows={2} />
          ) : !data?.controlRuns?.length ? (
            <EmptyState compact icon="clock" title="No control runs recorded yet" />
          ) : (
            <div className="flex flex-col divide-y divide-line-soft">
              {data.controlRuns.map((run) => (
                <div key={run.control} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <p className="text-sm text-charcoal">{CONTROL_LABELS[run.control] ?? run.control}</p>
                  <div className="flex items-center gap-2">
                    <Badge tone={run.outcome === 'ok' ? 'tone-low' : 'tone-high'} dot>
                      {run.outcome ?? 'unknown'}
                    </Badge>
                    <span className="text-xs text-muted">{formatDate(run.ranAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}

export default SecurityDashboard
