import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createExternalShare,
  listCaseShares,
  revokeExternalShare,
  MIN_PURPOSE_LENGTH,
  MAX_EXPIRES_DAYS,
  DEFAULT_EXPIRES_DAYS,
  MAX_ACTIVE_SHARES_PER_CASE,
  SCOPE_LABELS,
} from '../../services/shareService'
import { getCaseThreadForHandler } from '../../services/caseThreadService'
import { getAssignedCase } from '../../services/handlerService'
import { buildEvidenceInventory } from '../../utils/evidenceInventory'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'
import { Input, Select, Textarea } from '../ui/Field'
import { SkeletonList } from '../ui/Loading'

function formatDate(ms) {
  if (!ms) return '-'
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_TONE = {
  active: 'tone-low',
  revoked: 'tone-critical',
  expired: 'tone-neutral',
}

const EMPTY_FORM = {
  recipientName: '',
  recipientEmail: '',
  recipientOrganisation: '',
  purpose: '',
  expiresInDays: DEFAULT_EXPIRES_DAYS,
  scope: 'summary',
}

// The checkbox list a handler picks openable evidence from. Nothing is
// selected by default (EMPTY_FORM has no evidence field to default from) -
// every inclusion is an explicit, individual choice.
function EvidencePicker({ inventory, selected, onToggle }) {
  const { t } = useTranslation()
  if (inventory.length === 0) {
    return <p className="text-xs text-muted">{t('shareCasePanel.noEvidence')}</p>
  }
  return (
    <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-line p-3">
      {inventory.map((file) => {
        const checked = selected.includes(file.fileName)
        return (
          <label key={`${file.messageId}-${file.fileName}`} className="flex items-start gap-2 text-sm text-charcoal">
            <input type="checkbox" className="mt-0.5" checked={checked} onChange={() => onToggle(file.fileName)} />
            <span className="min-w-0">
              <span className="block font-medium">{file.label}</span>
              <span className="block text-xs text-muted">
                {t('shareCasePanel.fileMeta', {
                  type: file.contentType ?? t('shareCasePanel.unknownType'),
                  size: formatSize(file.sizeBytes),
                  supplier: file.supplier,
                  date: formatDate(file.uploadedAt),
                })}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function CreateShareForm({ caseId, disabled, evidenceInventory, isAnonymousTier, onCreated }) {
  const { t } = useTranslation()
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedFileNames, setSelectedFileNames] = useState([])
  const [evidenceAcknowledged, setEvidenceAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const purposeValid = form.purpose.trim().length >= MIN_PURPOSE_LENGTH
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.recipientEmail.trim())
  // Selecting at least one file makes the acknowledgement mandatory,
  // regardless of tier - see the module comment on the acknowledgement text
  // above for why an anonymous-tier case gets sharper wording rather than a
  // different gate.
  const evidenceAckOk = selectedFileNames.length === 0 || evidenceAcknowledged
  const canSubmit =
    form.recipientName.trim() &&
    emailValid &&
    form.recipientOrganisation.trim() &&
    purposeValid &&
    evidenceAckOk &&
    !submitting

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleFile(fileName) {
    setSelectedFileNames((prev) =>
      prev.includes(fileName) ? prev.filter((f) => f !== fileName) : [...prev, fileName]
    )
    setEvidenceAcknowledged(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const created = await createExternalShare(caseId, {
        ...form,
        recipientName: form.recipientName.trim(),
        recipientEmail: form.recipientEmail.trim(),
        recipientOrganisation: form.recipientOrganisation.trim(),
        purpose: form.purpose.trim(),
        expiresInDays: Number(form.expiresInDays),
        sharedEvidence: selectedFileNames,
      })
      setResult(created)
      setForm(EMPTY_FORM)
      setSelectedFileNames([])
      setEvidenceAcknowledged(false)
      await onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (disabled) {
    return (
      <Alert variant="warning" title={t('shareCasePanel.maxSharesTitle', { max: MAX_ACTIVE_SHARES_PER_CASE })}>
        {t('shareCasePanel.maxSharesBody', { max: MAX_ACTIVE_SHARES_PER_CASE })}
      </Alert>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Alert variant="info" title={t('shareCasePanel.deterrentNotice.title')}>
        {t('shareCasePanel.deterrentNotice.body')}
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t('shareCasePanel.recipientName')}
          value={form.recipientName}
          onChange={(e) => updateField('recipientName', e.target.value)}
          required
        />
        <Input
          label={t('shareCasePanel.recipientEmail')}
          type="email"
          value={form.recipientEmail}
          onChange={(e) => updateField('recipientEmail', e.target.value)}
          error={form.recipientEmail && !emailValid ? t('shareCasePanel.invalidEmail') : undefined}
          required
        />
      </div>

      <Input
        label={t('shareCasePanel.recipientOrganisation')}
        placeholder={t('shareCasePanel.recipientOrganisationPlaceholder')}
        value={form.recipientOrganisation}
        onChange={(e) => updateField('recipientOrganisation', e.target.value)}
        required
      />

      <Textarea
        label={t('shareCasePanel.purposeLabel')}
        rows={3}
        placeholder={t('shareCasePanel.purposePlaceholder', { min: MIN_PURPOSE_LENGTH })}
        value={form.purpose}
        onChange={(e) => updateField('purpose', e.target.value)}
        error={
          form.purpose && !purposeValid
            ? t('shareCasePanel.purposeError', { min: MIN_PURPOSE_LENGTH })
            : undefined
        }
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select label={t('shareCasePanel.scopeLabel')} value={form.scope} onChange={(e) => updateField('scope', e.target.value)}>
          {Object.entries(SCOPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          label={t('shareCasePanel.expiresInDays')}
          type="number"
          min={1}
          max={MAX_EXPIRES_DAYS}
          value={form.expiresInDays}
          onChange={(e) => updateField('expiresInDays', e.target.value)}
          hint={t('shareCasePanel.expiresHint', { max: MAX_EXPIRES_DAYS })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-charcoal">{t('shareCasePanel.evidenceToInclude')}</p>
        <p className="text-xs text-muted">{t('shareCasePanel.evidenceToIncludeHint')}</p>
        <EvidencePicker inventory={evidenceInventory} selected={selectedFileNames} onToggle={toggleFile} />
      </div>

      {selectedFileNames.length > 0 && (
        <label className="flex items-start gap-2 rounded-lg border border-gold-200 bg-gold-50 p-3 text-sm text-charcoal">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={evidenceAcknowledged}
            onChange={(e) => setEvidenceAcknowledged(e.target.checked)}
          />
          <span>{isAnonymousTier ? t('shareCasePanel.anonymousEvidenceAck') : t('shareCasePanel.defaultEvidenceAck')}</span>
        </label>
      )}

      <Button type="submit" variant="primary" className="self-start" loading={submitting} loadingLabel={t('shareCasePanel.creating')} disabled={!canSubmit}>
        {t('shareCasePanel.createShareButton')}
      </Button>

      {error && <Alert variant="error">{error}</Alert>}
      {result && (
        <Alert variant="success" title={t('shareCasePanel.shareCreated.title')}>
          {result.emailDelivered === false
            ? t('shareCasePanel.shareCreated.deliveryFailed')
            : t('shareCasePanel.shareCreated.body')}
        </Alert>
      )}
    </form>
  )
}

function ShareRow({ share, onChanged }) {
  const { t } = useTranslation()
  const [revoking, setRevoking] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  async function handleRevoke() {
    setSubmitting(true)
    setError(null)
    try {
      await revokeExternalShare(share.shareId, reason.trim() || undefined)
      setRevoking(false)
      setReason('')
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-charcoal">{share.recipientOrganisation}</p>
            <Badge tone={STATUS_TONE[share.status] ?? 'tone-neutral'} dot>
              {t(`caseStatus.${share.status}`, { defaultValue: share.status })}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {share.recipientName} · {SCOPE_LABELS[share.scope] ?? share.scope}
          </p>
          <p className="mt-1 text-sm text-charcoal">{share.purpose}</p>
          <p className="mt-1 text-xs text-muted">
            {t('shareCasePanel.createdExpiresAccess', {
              created: formatDate(share.createdAt),
              expires: formatDate(share.expiresAt),
              accessCount: share.accessCount,
            })}
            {share.lastAccessedAt ? t('shareCasePanel.lastAccessed', { date: formatDate(share.lastAccessedAt) }) : ''}
          </p>
          {share.acceptedAt && (
            <p className="mt-0.5 text-xs text-muted">
              {t('shareCasePanel.confidentialityAccepted', {
                name: share.acceptedName,
                date: formatDate(share.acceptedAt),
              })}
            </p>
          )}
          {share.status === 'revoked' && (
            <p className="mt-0.5 text-xs text-muted">
              {t('shareCasePanel.revokedOn', { date: formatDate(share.revokedAt) })}
              {share.revokedReason ? t('shareCasePanel.revokedReasonSuffix', { reason: share.revokedReason }) : ''}
            </p>
          )}
        </div>
        {share.status === 'active' && !revoking && (
          <Button variant="dangerGhost" size="sm" onClick={() => setRevoking(true)}>
            {t('shareCasePanel.revoke')}
          </Button>
        )}
      </div>

      {revoking && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          {error && <Alert variant="error">{error}</Alert>}
          <Textarea
            label={t('shareCasePanel.revokeReasonLabel')}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="danger" size="sm" loading={submitting} loadingLabel={t('shareCasePanel.revoking')} onClick={handleRevoke}>
              {t('shareCasePanel.confirmRevoke')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRevoking(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Case Handler-only (Company Admin has no path to any of the three
// callables this panel calls, enforced server-side regardless of what this
// component does). Lets the assigned handler grant, list, and revoke
// time-limited external access to this one case - see functions/src/sharing/.
function ShareCasePanel({ caseId }) {
  const { t } = useTranslation()
  const [shares, setShares] = useState(null)
  const [error, setError] = useState(null)
  const [evidenceInventory, setEvidenceInventory] = useState([])
  // Defaults to the stricter, anonymous-tier acknowledgement until the case
  // doc actually loads - an unknown tier should never relax the gate.
  const [isAnonymousTier, setIsAnonymousTier] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setShares(await listCaseShares(caseId))
    } catch (err) {
      setError(err.message)
    }
  }, [caseId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The file picker's own data, loaded independently of the shares list: the
  // same thread flatten CaseEvidencePanel.jsx (Module 36) uses via
  // buildEvidenceInventory, plus the case's tier for the acknowledgement
  // copy. A failure here degrades to "no files available" rather than
  // blocking the rest of the panel - a handler can still create a
  // no-evidence share even if this fetch fails.
  useEffect(() => {
    let cancelled = false
    async function loadEvidencePickerData() {
      try {
        const [caseData, messages] = await Promise.all([
          getAssignedCase(caseId),
          getCaseThreadForHandler(caseId),
        ])
        if (cancelled) return
        setIsAnonymousTier((caseData?.tier ?? 'anonymous') === 'anonymous')
        setEvidenceInventory(buildEvidenceInventory(messages))
      } catch {
        // Deliberately silent - see the comment above.
      }
    }
    loadEvidencePickerData()
    return () => {
      cancelled = true
    }
  }, [caseId])

  const activeCount = shares?.filter((s) => s.status === 'active').length ?? 0

  return (
    <div className="flex flex-col gap-5">
      <Card title={t('shareCasePanel.shareCardTitle')}>
        {error && <Alert variant="error">{error}</Alert>}
        {shares === null ? (
          <SkeletonList rows={2} />
        ) : (
          <CreateShareForm
            caseId={caseId}
            disabled={activeCount >= MAX_ACTIVE_SHARES_PER_CASE}
            evidenceInventory={evidenceInventory}
            isAnonymousTier={isAnonymousTier}
            onCreated={refresh}
          />
        )}
      </Card>

      <Card title={t('shareCasePanel.sharesCardTitle')} description={t('shareCasePanel.sharesCardDescription')}>
        {shares === null ? (
          <SkeletonList rows={2} />
        ) : shares.length === 0 ? (
          <EmptyState compact icon="shield" title={t('shareCasePanel.noShares')} />
        ) : (
          <div className="flex flex-col divide-y divide-line-soft">
            {shares.map((share) => (
              <ShareRow key={share.shareId} share={share} onChanged={refresh} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

export default ShareCasePanel
