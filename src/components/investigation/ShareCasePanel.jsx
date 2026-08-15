import { useCallback, useEffect, useState } from 'react'
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

function CreateShareForm({ caseId, disabled, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const purposeValid = form.purpose.trim().length >= MIN_PURPOSE_LENGTH
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.recipientEmail.trim())
  const canSubmit =
    form.recipientName.trim() && emailValid && form.recipientOrganisation.trim() && purposeValid && !submitting

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }))
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
      })
      setResult(created)
      setForm(EMPTY_FORM)
      await onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (disabled) {
    return (
      <Alert variant="warning" title={`${MAX_ACTIVE_SHARES_PER_CASE} active shares already exist`}>
        More than {MAX_ACTIVE_SHARES_PER_CASE} active shares on one case is not a legal consultation, it is
        distribution. Revoke one below before creating another.
      </Alert>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Alert variant="info" title="This deters leaks; it cannot prevent them">
        The recipient's name and organisation are watermarked into every panel of the shared view and
        re-rendered live, so a screenshot carries attribution. That is a deterrent, not a guarantee - only
        share with someone you would trust with a printed copy.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Recipient name"
          value={form.recipientName}
          onChange={(e) => updateField('recipientName', e.target.value)}
          required
        />
        <Input
          label="Recipient email"
          type="email"
          value={form.recipientEmail}
          onChange={(e) => updateField('recipientEmail', e.target.value)}
          error={form.recipientEmail && !emailValid ? 'Enter a valid email address' : undefined}
          required
        />
      </div>

      <Input
        label="Recipient organisation"
        placeholder="e.g. Outside employment counsel, XYZ LLP"
        value={form.recipientOrganisation}
        onChange={(e) => updateField('recipientOrganisation', e.target.value)}
        required
      />

      <Textarea
        label="Purpose"
        rows={3}
        placeholder={`Why this case is being shared (min. ${MIN_PURPOSE_LENGTH} characters). This is a legal disclosure, not a formality.`}
        value={form.purpose}
        onChange={(e) => updateField('purpose', e.target.value)}
        error={
          form.purpose && !purposeValid
            ? `At least ${MIN_PURPOSE_LENGTH} characters required`
            : undefined
        }
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Scope" value={form.scope} onChange={(e) => updateField('scope', e.target.value)}>
          {Object.entries(SCOPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          label="Expires in (days)"
          type="number"
          min={1}
          max={MAX_EXPIRES_DAYS}
          value={form.expiresInDays}
          onChange={(e) => updateField('expiresInDays', e.target.value)}
          hint={`Maximum ${MAX_EXPIRES_DAYS} days. No renewal or extension - an expired share is recreated deliberately or not at all.`}
        />
      </div>

      <Button type="submit" variant="primary" className="self-start" loading={submitting} loadingLabel="Creating" disabled={!canSubmit}>
        Create share and email link
      </Button>

      {error && <Alert variant="error">{error}</Alert>}
      {result && (
        <Alert variant="success" title="Share created">
          An email with the access link was sent to the recipient
          {result.emailDelivered === false ? ' - delivery failed, contact them directly.' : '.'}
        </Alert>
      )}
    </form>
  )
}

function ShareRow({ share, onChanged }) {
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
              {share.status}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {share.recipientName} · {SCOPE_LABELS[share.scope] ?? share.scope}
          </p>
          <p className="mt-1 text-sm text-charcoal">{share.purpose}</p>
          <p className="mt-1 text-xs text-muted">
            Created {formatDate(share.createdAt)} · expires {formatDate(share.expiresAt)} ·{' '}
            {share.accessCount} access{share.accessCount === 1 ? '' : 'es'}
            {share.lastAccessedAt ? `, last ${formatDate(share.lastAccessedAt)}` : ''}
          </p>
          {share.acceptedAt && (
            <p className="mt-0.5 text-xs text-muted">
              Confidentiality undertaking accepted by "{share.acceptedName}" on {formatDate(share.acceptedAt)}
            </p>
          )}
          {share.status === 'revoked' && (
            <p className="mt-0.5 text-xs text-muted">
              Revoked {formatDate(share.revokedAt)}
              {share.revokedReason ? ` - ${share.revokedReason}` : ''}
            </p>
          )}
        </div>
        {share.status === 'active' && !revoking && (
          <Button variant="dangerGhost" size="sm" onClick={() => setRevoking(true)}>
            Revoke
          </Button>
        )}
      </div>

      {revoking && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
          {error && <Alert variant="error">{error}</Alert>}
          <Textarea
            label="Reason for revoking (optional)"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="danger" size="sm" loading={submitting} loadingLabel="Revoking" onClick={handleRevoke}>
              Confirm revoke
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRevoking(false)} disabled={submitting}>
              Cancel
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
  const [shares, setShares] = useState(null)
  const [error, setError] = useState(null)

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

  const activeCount = shares?.filter((s) => s.status === 'active').length ?? 0

  return (
    <div className="flex flex-col gap-5">
      <Card title="Share this case with an external advisor">
        {error && <Alert variant="error">{error}</Alert>}
        {shares === null ? (
          <SkeletonList rows={2} />
        ) : (
          <CreateShareForm caseId={caseId} disabled={activeCount >= MAX_ACTIVE_SHARES_PER_CASE} onCreated={refresh} />
        )}
      </Card>

      <Card title="Shares" description="Active and past external shares for this case.">
        {shares === null ? (
          <SkeletonList rows={2} />
        ) : shares.length === 0 ? (
          <EmptyState compact icon="shield" title="No external shares yet" />
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
