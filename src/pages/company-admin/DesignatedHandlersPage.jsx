import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { getCompany } from '../../services/companyService'
import { listCaseHandlers } from '../../services/routingService'
import {
  CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT,
  acknowledgeConfidentiality,
  designateHandler,
  getMyDesignation,
  listDesignatedHandlers,
  revokeHandlerDesignation,
} from '../../services/designatedHandlerService'
import Alert from '../../components/ui/Alert'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import Icon from '../../components/ui/Icon'
import { SkeletonList } from '../../components/ui/Loading'

function formatDate(value) {
  const ms = value?.toMillis?.() ?? (typeof value === 'number' ? value : null)
  if (!ms) return '-'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// A designation is only complete once BOTH an active designation AND the
// handler's own acknowledgment exist - see designatedHandlers.js. This maps
// that pair, plus 'revoked' and 'none' (never designated at all), to the
// label/tone/icon this page renders everywhere a status appears.
function designationStatus(record, t) {
  if (!record || record.status !== 'active') {
    return record?.status === 'revoked'
      ? { key: 'revoked', label: t('designatedHandlersPage.status.revoked'), tone: 'tone-neutral', icon: 'close' }
      : { key: 'none', label: t('designatedHandlersPage.status.none'), tone: 'tone-neutral', icon: 'close' }
  }
  return record.confidentialityAcknowledgedAt
    ? { key: 'acknowledged', label: t('designatedHandlersPage.status.acknowledged'), tone: 'tone-low', icon: 'check' }
    : { key: 'pending', label: t('designatedHandlersPage.status.pending'), tone: 'tone-medium', icon: 'clock' }
}

// The Company Admin / designatedHandlers-permitted management console: lists
// every Case Handler, their current designation status, and a designate or
// revoke action. Read-only for everyone else, the same posture as
// RoutingRulesPage's own list vs. its edit controls.
function ManagementList({ companyId, handlers, designations, loading, onChanged }) {
  const { t } = useTranslation()
  const [busyStaffId, setBusyStaffId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  async function handleDesignate(staffId) {
    setBusyStaffId(staffId)
    setError(null)
    setNotice(null)
    try {
      await designateHandler(companyId, staffId)
      setNotice(t('designatedHandlersPage.designatedNotice'))
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyStaffId(null)
    }
  }

  async function handleRevoke(staffId) {
    setBusyStaffId(staffId)
    setError(null)
    setNotice(null)
    try {
      await revokeHandlerDesignation(companyId, staffId, 'Revoked from the designated handler register')
      setNotice(t('designatedHandlersPage.revokedNotice'))
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyStaffId(null)
    }
  }

  if (loading) return <SkeletonList rows={3} />

  if (handlers.length === 0) {
    return (
      <EmptyState
        icon="shield"
        title={t('designatedHandlersPage.noHandlers.title')}
        description={t('designatedHandlersPage.noHandlers.description')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card
        title={t('adminNav.pageTitles.staff')}
        description={t('designatedHandlersPage.onStaff', { count: handlers.length })}
        padded={false}
      >
        <ul className="divide-y divide-line-soft">
          {handlers.map((handler) => {
            const record = designations.find((d) => d.id === handler.id) ?? null
            const status = designationStatus(record, t)
            const isActive = record?.status === 'active'
            const busy = busyStaffId === handler.id

            return (
              <li key={handler.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-charcoal">
                    {handler.email ?? handler.id}
                  </p>
                  {record && (
                    <p className="mt-0.5 text-xs text-muted">
                      {t('designatedHandlersPage.designatedOn', { date: formatDate(record.designatedAt) })}
                      {record.status === 'revoked' &&
                        ` · ${t('designatedHandlersPage.revokedOn', { date: formatDate(record.revokedAt) })}`}
                    </p>
                  )}
                </div>

                <Badge tone={status.tone} icon={status.icon}>
                  {status.label}
                </Badge>

                {isActive ? (
                  <Button
                    variant="dangerGhost"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleRevoke(handler.id)}
                  >
                    {t('designatedHandlersPage.revoke')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="shield"
                    disabled={busy}
                    onClick={() => handleDesignate(handler.id)}
                  >
                    {t('designatedHandlersPage.designate')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}

// The handler's own self-service view: their current status, and - only
// while a designation is active but not yet acknowledged - the exact
// confidentiality text they are being asked to accept. The callable behind
// this only ever acts on the caller's own uid, so there is nothing here for
// anyone to do on behalf of someone else.
function SelfAcknowledgment({ companyId, record, loading, onChanged }) {
  const { t } = useTranslation()
  const [acknowledging, setAcknowledging] = useState(false)
  const [error, setError] = useState(null)

  async function handleAcknowledge() {
    setAcknowledging(true)
    setError(null)
    try {
      await acknowledgeConfidentiality(companyId)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setAcknowledging(false)
    }
  }

  if (loading) return <SkeletonList rows={1} />

  const status = designationStatus(record, t)

  if (!record || record.status !== 'active') {
    return (
      <Card title={t('designatedHandlersPage.yourStatus')}>
        <EmptyState
          compact
          icon="shield"
          title={
            record?.status === 'revoked'
              ? t('designatedHandlersPage.self.revokedTitle')
              : t('designatedHandlersPage.self.notDesignatedTitle')
          }
          description={t('designatedHandlersPage.self.askAdmin')}
        />
      </Card>
    )
  }

  if (record.confidentialityAcknowledgedAt) {
    return (
      <Card title={t('designatedHandlersPage.yourStatus')}>
        <div className="flex items-center gap-2.5">
          <Badge tone={status.tone} icon={status.icon}>
            {status.label}
          </Badge>
          <span className="text-xs text-muted">
            {t('designatedHandlersPage.self.acknowledgedOn', {
              date: formatDate(record.confidentialityAcknowledgedAt),
            })}
          </span>
        </div>
      </Card>
    )
  }

  return (
    <Card
      title={t('designatedHandlersPage.self.acknowledgmentRequired.title')}
      description={t('designatedHandlersPage.self.acknowledgmentRequired.description')}
    >
      <div className="flex flex-col gap-3">
        {error && <Alert variant="error">{error}</Alert>}
        {/* CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT is fixed legal text tied to
            Japan's Whistleblower Protection Act - left untranslated rather
            than machine-translated, same reasoning as the draft privacy
            policy/terms: an inaccurate translation of a statutory obligation
            is worse than none, and this text (unlike those) isn't even
            marked draft, so there's no safe placeholder to fall back to. */}
        <p className="rounded-lg border border-line bg-canvas px-3.5 py-3 text-sm text-charcoal">
          {CONFIDENTIALITY_ACKNOWLEDGMENT_TEXT}
        </p>
        <Button
          variant="primary"
          icon="check"
          loading={acknowledging}
          loadingLabel={t('designatedHandlersPage.self.acknowledging')}
          onClick={handleAcknowledge}
          className="self-start"
        >
          {t('designatedHandlersPage.self.acknowledgeButton')}
        </Button>
      </div>
    </Card>
  )
}

// Module: JP's designated-handler (従事者) register. Company Admin (or a
// designatedHandlers-permitted custom role) manages the whole register; a
// Case Handler visiting this same page sees only their own status and, while
// a designation is pending, the acknowledgment they need to accept. The two
// views never overlap for one account - a staff record holds exactly one
// fixed role or custom role, never both - so this component picks a single
// view rather than trying to show both.
//
// Constraint: this register holds designation metadata only - no case
// content, no case IDs, no counts of cases handled - and nothing here is
// ever shown on any reporter-facing view.
function DesignatedHandlersPage({ companyId }) {
  const { t } = useTranslation()
  const { user, role, hasPermission } = useAuth()
  const isManager = role === 'companyAdmin' || hasPermission('designatedHandlers')
  const isSelfHandler = !isManager && role === 'caseHandler'

  const [company, setCompany] = useState(null)
  const [handlers, setHandlers] = useState([])
  const [designations, setDesignations] = useState([])
  const [myDesignation, setMyDesignation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isManager) {
        const [companyData, handlerRows, designationRows] = await Promise.all([
          getCompany(companyId),
          listCaseHandlers(companyId),
          listDesignatedHandlers(companyId),
        ])
        setCompany(companyData)
        setHandlers(handlerRows)
        setDesignations(designationRows)
      } else if (isSelfHandler) {
        const [companyData, myRecord] = await Promise.all([
          getCompany(companyId),
          getMyDesignation(companyId),
        ])
        setCompany(companyData)
        setMyDesignation(myRecord)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId, isManager, isSelfHandler])

  useEffect(() => {
    if (companyId) refresh()
  }, [companyId, refresh])

  const isJp = company?.jurisdictions?.includes('JP') ?? false

  if (!isManager && !isSelfHandler) {
    return (
      <Alert variant="error" title={t('designatedHandlersPage.notAvailable.title')}>
        {t('designatedHandlersPage.notAvailable.body')}
      </Alert>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">{t('designatedHandlersPage.description')}</p>

      {error && <Alert variant="error">{error}</Alert>}

      {!loading && !isJp && (
        <Alert variant="info" title={t('designatedHandlersPage.notConfigured.title')}>
          {t('designatedHandlersPage.notConfigured.body')}
        </Alert>
      )}

      {isManager ? (
        <ManagementList
          companyId={companyId}
          handlers={handlers}
          designations={designations}
          loading={loading}
          onChanged={refresh}
        />
      ) : (
        <SelfAcknowledgment
          companyId={companyId}
          record={myDesignation}
          loading={loading}
          onChanged={refresh}
        />
      )}

      {!isManager && user?.email && (
        <p className="text-xs text-subtle">
          <Icon name="staff" className="mr-1 inline h-3 w-3" />
          {t('designatedHandlersPage.signedInAs', { email: user.email })}
        </p>
      )}
    </div>
  )
}

export default DesignatedHandlersPage
