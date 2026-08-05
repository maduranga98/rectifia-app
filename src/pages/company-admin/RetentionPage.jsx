import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  RETENTION_FIELDS,
  RETENTION_FLOORS,
  RETENTION_CEILINGS,
  getCompanyRetention,
  listLegalHolds,
  previewRetention,
  releaseLegalHold,
  resolveRetentionPolicy,
  retentionFieldError,
  setLegalHold,
  updateCompanyRetention,
} from '../../services/retentionService'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import { Input, Textarea } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Loading'

function years(days) {
  return (days / 365).toFixed(days % 365 === 0 ? 0 : 1)
}

function formatDuration(days) {
  return `${days} days (~${years(days)} year${years(days) === '1' ? '' : 's'})`
}

function formatDate(ms) {
  if (!ms) return 'unknown'
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function sameValues(a, b) {
  if (!a || !b) return false
  return RETENTION_FIELDS.every((f) => a[f.key] === b[f.key])
}

function TierPreview({ title, result }) {
  if (!result) return null
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-charcoal">{title}</p>
      {result.count === 0 ? (
        <p className="mt-1 text-xs text-muted">Nothing would be deleted on the next run.</p>
      ) : (
        <p className="mt-1 text-xs text-muted">
          <strong className="text-charcoal">
            {result.count}
            {result.truncated ? '+' : ''}
          </strong>{' '}
          record{result.count === 1 ? '' : 's'} would be deleted, spanning {formatDate(result.oldest)} to{' '}
          {formatDate(result.newest)}
          {result.truncated ? ' (count is a floor - more match than were scanned)' : ''}.
        </p>
      )}
    </div>
  )
}

// Company Admin's data retention & deletion controls (module 23). No soft
// delete, no archive collection, no undo window anywhere on this page -
// every action here is either a config write with a floor, a permanent
// deletion, or a legal hold that blocks permanent deletion. There is
// deliberately no "delete all company data" button: company offboarding is a
// Super Admin operation with contractual steps around it, not a self-service
// control that belongs next to a retention-window input.
function RetentionPage({ companyId }) {
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const [values, setValues] = useState(null)
  const [saving, setSaving] = useState(false)

  const [preview, setPreview] = useState(null)
  const [previewedFor, setPreviewedFor] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  const [holds, setHolds] = useState([])
  const [holdsLoading, setHoldsLoading] = useState(true)
  const [holdCaseId, setHoldCaseId] = useState('')
  const [holdReason, setHoldReason] = useState('')
  const [placingHold, setPlacingHold] = useState(false)
  const [releasingCaseId, setReleasingCaseId] = useState(null)
  const [releaseReason, setReleaseReason] = useState('')
  const [releasing, setReleasing] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const companyData = await getCompanyRetention(companyId)
      setCompany(companyData)
      const resolved = resolveRetentionPolicy(companyData)
      setValues(resolved)
      // A fresh load has nothing staged yet, so there is nothing to compare
      // a shortened window against - clear any stale preview from a
      // previous company/session.
      setPreview(null)
      setPreviewedFor(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  const refreshHolds = useCallback(async () => {
    setHoldsLoading(true)
    try {
      const list = await listLegalHolds(companyId)
      setHolds(list)
    } catch (err) {
      setError(err.message)
    } finally {
      setHoldsLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) {
      refresh()
      refreshHolds()
    }
  }, [companyId, refresh, refreshHolds])

  const savedPolicy = useMemo(() => resolveRetentionPolicy(company), [company])

  const fieldErrors = useMemo(() => {
    if (!values) return {}
    const errors = {}
    for (const field of RETENTION_FIELDS) {
      const err = retentionFieldError(field.key, Number(values[field.key]))
      if (err) errors[field.key] = err
    }
    return errors
  }, [values])

  const hasErrors = Object.keys(fieldErrors).length > 0

  // Any field set lower than what is currently saved is a shortening -
  // permanently deleting more, sooner. Lengthening a window, or leaving it
  // unchanged, never needs a preview first.
  const isShortening = useMemo(() => {
    if (!values || !savedPolicy) return false
    return RETENTION_FIELDS.some((f) => Number(values[f.key]) < savedPolicy[f.key])
  }, [values, savedPolicy])

  const changed = useMemo(() => !sameValues(values, savedPolicy), [values, savedPolicy])
  const previewCurrent = sameValues(previewedFor, values)
  const canSave = changed && !hasErrors && (!isShortening || (preview && previewCurrent))

  function updateField(key, raw) {
    const parsed = Number.parseInt(raw, 10)
    setValues((current) => ({ ...current, [key]: Number.isNaN(parsed) ? '' : parsed }))
  }

  async function handlePreview() {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const result = await previewRetention(companyId, values)
      setPreview(result)
      setPreviewedFor(values)
    } catch (err) {
      setPreviewError(err.message)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await updateCompanyRetention(companyId, values)
      await refresh()
      setNotice('Retention settings saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handlePlaceHold(event) {
    event.preventDefault()
    if (!holdCaseId.trim() || holdReason.trim().length < 10) return
    setPlacingHold(true)
    setError(null)
    setNotice(null)
    try {
      await setLegalHold(holdCaseId.trim(), holdReason.trim())
      setHoldCaseId('')
      setHoldReason('')
      await refreshHolds()
      setNotice(`Legal hold placed on case ${holdCaseId.trim()}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setPlacingHold(false)
    }
  }

  async function handleRelease(caseId) {
    if (releaseReason.trim().length < 10) return
    setReleasing(true)
    setError(null)
    setNotice(null)
    try {
      await releaseLegalHold(caseId, releaseReason.trim())
      setReleasingCaseId(null)
      setReleaseReason('')
      await refreshHolds()
      setNotice(`Legal hold released on case ${caseId}. It is now eligible for the next retention sweep.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setReleasing(false)
    }
  }

  if (loading && !values) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <SkeletonList rows={4} />
      </div>
    )
  }

  const summarySentence = values
    ? `Closed cases are permanently deleted ${formatDuration(values.caseRetentionDays)} after closure. Reporter identities are deleted after ${formatDuration(values.identityRetentionDays)}. This cannot be undone.`
    : ''

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">
        How long this company keeps case data before it is permanently deleted, and which cases are
        currently frozen against deletion by a legal hold. Deletion here is hard deletion - there is no
        soft-delete flag, no archive, and no recovery window.
      </p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card title="Retention windows" description={summarySentence}>
        <div className="flex flex-col gap-5">
          {RETENTION_FIELDS.map((field) => (
            <div key={field.key} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
              <div>
                <Input
                  label={field.label}
                  type="number"
                  min={RETENTION_FLOORS[field.key]}
                  max={RETENTION_CEILINGS[field.key] ?? undefined}
                  value={values?.[field.key] ?? ''}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  error={fieldErrors[field.key]}
                  hint={
                    !fieldErrors[field.key]
                      ? `Floor: ${RETENTION_FLOORS[field.key]} days${
                          RETENTION_CEILINGS[field.key]
                            ? `, ceiling: ${RETENTION_CEILINGS[field.key]} days`
                            : ' (no ceiling)'
                        }. ${field.description}`
                      : field.description
                  }
                />
              </div>
            </div>
          ))}

          {isShortening && !hasErrors && (
            <Alert variant="warning" title="This shortens at least one window">
              Run a preview below before saving - a shortened window deletes more, sooner, and this
              cannot be undone once the next sweep runs.
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              loadingLabel="Saving"
              disabled={!canSave}
            >
              Save retention settings
            </Button>
            {changed && !canSave && !hasErrors && (
              <span className="text-xs text-muted">Preview this exact change before saving.</span>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Preview next sweep"
        description="A dry run against the values above - shows what would be permanently deleted the next time the retention sweep runs. Deletes nothing."
        footer={
          <Button variant="secondary" onClick={handlePreview} loading={previewLoading} loadingLabel="Checking" disabled={hasErrors}>
            {preview ? 'Refresh preview' : 'Run preview'}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {previewError && <Alert variant="error">{previewError}</Alert>}
          {!preview && !previewError && (
            <p className="text-sm text-muted">Run a preview to see counts before saving.</p>
          )}
          {preview && (
            <>
              {!previewCurrent && (
                <Alert variant="info">
                  These results are for a previously entered set of values, not the ones currently in
                  the form. Run the preview again to see the current values.
                </Alert>
              )}
              <TierPreview title="Tier 1 - reporter identity & contact data" result={preview.tier1} />
              <TierPreview title="Tier 2 - case content (permanent case deletion)" result={preview.tier2} />
              <TierPreview title="Pulse Check responses" result={preview.pulseResponses} />
            </>
          )}
        </div>
      </Card>

      <Card
        title="Legal holds"
        description="A case on legal hold is skipped by every retention sweep, including the identity-purge tier - litigation freezes identity data too. Restricted to Company Admin and Super Admin."
      >
        <div className="flex flex-col gap-5">
          <form onSubmit={handlePlaceHold} className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <p className="text-sm font-medium text-charcoal">Place a hold</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Case ID"
                placeholder="RC-2026-0001"
                value={holdCaseId}
                onChange={(e) => setHoldCaseId(e.target.value)}
              />
            </div>
            <Textarea
              label="Reason"
              rows={2}
              placeholder="Why this case must be frozen against deletion (min. 10 characters)."
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              className="self-start"
              loading={placingHold}
              loadingLabel="Placing hold"
              disabled={!holdCaseId.trim() || holdReason.trim().length < 10}
            >
              Place legal hold
            </Button>
          </form>

          {holdsLoading ? (
            <SkeletonList rows={2} />
          ) : holds.length === 0 ? (
            <EmptyState compact icon="shield" title="No cases currently on legal hold" />
          ) : (
            <div className="flex flex-col divide-y divide-line-soft">
              {holds.map((hold) => (
                <div key={hold.caseId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-charcoal">{hold.caseId}</p>
                    <span className="text-xs text-muted">
                      Set {formatDate(hold.setAt)} by {hold.setByUid ?? 'unknown'}
                    </span>
                  </div>
                  <p className="text-sm text-charcoal">{hold.reason}</p>

                  {releasingCaseId === hold.caseId ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        label="Reason for releasing this hold"
                        rows={2}
                        value={releaseReason}
                        onChange={(e) => setReleaseReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="danger"
                          onClick={() => handleRelease(hold.caseId)}
                          loading={releasing}
                          loadingLabel="Releasing"
                          disabled={releaseReason.trim().length < 10}
                        >
                          Confirm release
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setReleasingCaseId(null)
                            setReleaseReason('')
                          }}
                          disabled={releasing}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      className="self-start"
                      onClick={() => setReleasingCaseId(hold.caseId)}
                    >
                      Release hold
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

export default RetentionPage
