import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../services/i18n'
import {
  RETENTION_FIELDS,
  RETENTION_FLOORS,
  RETENTION_CEILINGS,
  JURISDICTION_RETENTION,
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
  return i18n.t('retentionPage.durationDays', { days, years: years(days), count: Number(years(days)) })
}

function formatDate(ms) {
  if (!ms) return i18n.t('retentionPage.unknownDate')
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function sameValues(a, b) {
  if (!a || !b) return false
  return RETENTION_FIELDS.every((f) => a[f.key] === b[f.key])
}

// Which of the company's jurisdictions actually produced this field's
// resolved ceiling - so "Maximum 2,555 days" can say *why*, e.g.
// "constrained by your EU jurisdiction", instead of just showing a number.
function jurisdictionsConstraining(key, ceiling, basis) {
  if (typeof ceiling !== 'number' || !basis?.length) return []
  const ceilingKey = key.replace(/Days$/, 'Ceiling')
  return basis.filter((code) => JURISDICTION_RETENTION[code]?.[ceilingKey] === ceiling)
}

function TierPreview({ title, result }) {
  const { t } = useTranslation()
  if (!result) return null
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium text-charcoal">{title}</p>
      {result.count === 0 ? (
        <p className="mt-1 text-xs text-muted">{t('retentionPage.tierPreview.nothingToDelete')}</p>
      ) : (
        <p className="mt-1 text-xs text-muted">
          <strong className="text-charcoal">
            {result.count}
            {result.truncated ? '+' : ''}
          </strong>{' '}
          {t('retentionPage.tierPreview.recordsWouldBeDeleted', {
            count: result.count,
            oldest: formatDate(result.oldest),
            newest: formatDate(result.newest),
          })}
          {result.truncated ? t('retentionPage.tierPreview.truncatedNote') : ''}.
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
  const { t } = useTranslation()
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
      const ceiling = savedPolicy?.resolvedCeilings?.[field.key]
      const err = retentionFieldError(field.key, Number(values[field.key]), ceiling)
      if (err) errors[field.key] = err
    }
    return errors
  }, [values, savedPolicy])

  const hasErrors = Object.keys(fieldErrors).length > 0

  // A company's stored value can end up above a jurisdiction-resolved
  // ceiling it didn't originally have to answer to - most commonly an
  // existing company that later adds a jurisdiction with a tighter ceiling
  // (e.g. EU). savedPolicy is already clamped, so savedPolicy[key] here is
  // exactly what the next sweep will use; this only flags when that differs
  // from what's actually stored, never rewrites the stored config itself.
  const clampedOnNextRun = useMemo(() => {
    if (!company || !savedPolicy) return []
    const stored = company.retention ?? {}
    return RETENTION_FIELDS.filter((field) => {
      const raw = stored[field.key]
      const ceiling = savedPolicy.resolvedCeilings?.[field.key]
      return Number.isInteger(raw) && raw > 0 && typeof ceiling === 'number' && raw > ceiling
    }).map((field) => ({ field, stored: stored[field.key], clampedTo: savedPolicy[field.key] }))
  }, [company, savedPolicy])

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
      setNotice(t('retentionPage.savedNotice'))
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
      setNotice(t('retentionPage.holdPlacedNotice', { caseId: holdCaseId.trim() }))
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
      setNotice(t('retentionPage.holdReleasedNotice', { caseId }))
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
    ? t('retentionPage.summary', {
        caseDuration: formatDuration(values.caseRetentionDays),
        identityDuration: formatDuration(values.identityRetentionDays),
      })
    : ''

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">{t('retentionPage.intro')}</p>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card title={t('retentionPage.windowsCard.title')} description={summarySentence}>
        <div className="flex flex-col gap-5">
          {RETENTION_FIELDS.map((field) => {
            const ceiling = savedPolicy?.resolvedCeilings?.[field.key] ?? RETENTION_CEILINGS[field.key]
            const constrainingJurisdictions = jurisdictionsConstraining(
              field.key,
              ceiling,
              savedPolicy?.jurisdictionBasis,
            )
            const fieldLabel = t(`retentionPage.fields.${field.key}.label`, { defaultValue: field.label })
            const fieldDescription = t(`retentionPage.fields.${field.key}.description`, {
              defaultValue: field.description,
            })
            const floorText = t('retentionPage.floor', { days: RETENTION_FLOORS[field.key] })
            const maxText = ceiling
              ? t('retentionPage.maximum', {
                  days: ceiling.toLocaleString(),
                  constraint: constrainingJurisdictions.length
                    ? t('retentionPage.constrainedBy', {
                        jurisdictions: constrainingJurisdictions.join('/'),
                        count: constrainingJurisdictions.length,
                      })
                    : '',
                })
              : t('retentionPage.noCeiling')
            return (
              <div key={field.key} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
                <div>
                  <Input
                    label={fieldLabel}
                    type="number"
                    min={RETENTION_FLOORS[field.key]}
                    max={ceiling ?? undefined}
                    value={values?.[field.key] ?? ''}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    error={fieldErrors[field.key]}
                    hint={
                      !fieldErrors[field.key]
                        ? `${floorText}${maxText}. ${fieldDescription}`
                        : fieldDescription
                    }
                  />
                </div>
              </div>
            )
          })}

          {clampedOnNextRun.length > 0 && (
            <Alert variant="warning" title={t('retentionPage.clampedWarning.title')}>
              <ul className="list-disc pl-4">
                {clampedOnNextRun.map(({ field, stored, clampedTo }) => (
                  <li key={field.key}>
                    {t('retentionPage.clampedWarning.item', {
                      label: t(`retentionPage.fields.${field.key}.label`, { defaultValue: field.label }),
                      stored: stored.toLocaleString(),
                      clampedTo: clampedTo.toLocaleString(),
                    })}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {isShortening && !hasErrors && (
            <Alert variant="warning" title={t('retentionPage.shorteningWarning.title')}>
              {t('retentionPage.shorteningWarning.body')}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              loadingLabel={t('retentionPage.saving')}
              disabled={!canSave}
            >
              {t('retentionPage.saveButton')}
            </Button>
            {changed && !canSave && !hasErrors && (
              <span className="text-xs text-muted">{t('retentionPage.previewFirstHint')}</span>
            )}
          </div>
        </div>
      </Card>

      <Card
        title={t('retentionPage.previewCard.title')}
        description={t('retentionPage.previewCard.description')}
        footer={
          <Button
            variant="secondary"
            onClick={handlePreview}
            loading={previewLoading}
            loadingLabel={t('retentionPage.checking')}
            disabled={hasErrors}
          >
            {preview ? t('retentionPage.previewCard.refresh') : t('retentionPage.previewCard.run')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {previewError && <Alert variant="error">{previewError}</Alert>}
          {!preview && !previewError && (
            <p className="text-sm text-muted">{t('retentionPage.previewCard.hint')}</p>
          )}
          {preview && (
            <>
              {!previewCurrent && <Alert variant="info">{t('retentionPage.previewCard.stale')}</Alert>}
              <TierPreview title={t('retentionPage.tiers.identity')} result={preview.tier1} />
              <TierPreview title={t('retentionPage.tiers.caseContent')} result={preview.tier2} />
              <TierPreview title={t('retentionPage.tiers.pulseResponses')} result={preview.pulseResponses} />
            </>
          )}
        </div>
      </Card>

      <Card
        title={t('retentionPage.legalHolds.title')}
        description={t('retentionPage.legalHolds.description')}
      >
        <div className="flex flex-col gap-5">
          <form onSubmit={handlePlaceHold} className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <p className="text-sm font-medium text-charcoal">{t('retentionPage.legalHolds.placeHold')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t('retentionPage.legalHolds.caseIdLabel')}
                placeholder="RC-2026-0001"
                value={holdCaseId}
                onChange={(e) => setHoldCaseId(e.target.value)}
              />
            </div>
            <Textarea
              label={t('retentionPage.legalHolds.reasonLabel')}
              rows={2}
              placeholder={t('retentionPage.legalHolds.reasonPlaceholder')}
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              className="self-start"
              loading={placingHold}
              loadingLabel={t('retentionPage.legalHolds.placingHold')}
              disabled={!holdCaseId.trim() || holdReason.trim().length < 10}
            >
              {t('retentionPage.legalHolds.placeButton')}
            </Button>
          </form>

          {holdsLoading ? (
            <SkeletonList rows={2} />
          ) : holds.length === 0 ? (
            <EmptyState compact icon="shield" title={t('retentionPage.legalHolds.empty')} />
          ) : (
            <div className="flex flex-col divide-y divide-line-soft">
              {holds.map((hold) => (
                <div key={hold.caseId} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-charcoal">{hold.caseId}</p>
                    <span className="text-xs text-muted">
                      {t('retentionPage.legalHolds.setBy', {
                        date: formatDate(hold.setAt),
                        uid: hold.setByUid ?? t('retentionPage.legalHolds.unknownUid'),
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-charcoal">{hold.reason}</p>

                  {releasingCaseId === hold.caseId ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        label={t('retentionPage.legalHolds.releaseReasonLabel')}
                        rows={2}
                        value={releaseReason}
                        onChange={(e) => setReleaseReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="danger"
                          onClick={() => handleRelease(hold.caseId)}
                          loading={releasing}
                          loadingLabel={t('retentionPage.legalHolds.releasing')}
                          disabled={releaseReason.trim().length < 10}
                        >
                          {t('retentionPage.legalHolds.confirmRelease')}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setReleasingCaseId(null)
                            setReleaseReason('')
                          }}
                          disabled={releasing}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      className="self-start"
                      onClick={() => setReleasingCaseId(hold.caseId)}
                    >
                      {t('retentionPage.legalHolds.releaseButton')}
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
