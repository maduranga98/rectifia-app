import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPolicyDownloadUrl, listPolicyCitations } from '../../services/policyService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'

// Groups a flat list of citations/chunks by document (policyId), matching the
// shape byDocument has always produced: one entry per document with its title,
// version, and the list of clause-level entries contributed to it.
function groupByDocument(entries, t) {
  const byDocument = entries.reduce((acc, entry) => {
    const key = entry.policyId
    if (!key) return acc
    if (!acc[key]) {
      acc[key] = {
        policyId: entry.policyId,
        title: entry.title ?? t('policyReferences.policyDocument'),
        version: entry.version ?? null,
        clauses: [],
      }
    }
    acc[key].clauses.push(entry)
    return acc
  }, {})
  return Object.values(byDocument)
}

// Read-only card for the Case Handler's case view. It lists exactly the policy
// clauses that were used as grounding context for THIS case - taken from the
// citations recorded on the case doc at scoring/checklist time
// (case.policyCitations), so it shows real provenance rather than an
// unverifiable claim of grounding. Each entry links to the source document via
// a fresh short-lived signed URL.
//
// This never asserts that the reported conduct violates a clause, and never
// states a conclusion: it is a record of what the AI read, not a finding.
function PolicyReferences({ caseData }) {
  const { t } = useTranslation()
  const [error, setError] = useState(null)
  const [openingId, setOpeningId] = useState(null)

  const citations = Array.isArray(caseData?.policyCitations) ? caseData.policyCitations : []

  // Group by document (title + version) so a document contributing several
  // clauses appears once with its clauses listed under it.
  const documents = groupByDocument(citations, t)
  const primaryDocuments = documents.filter((document) => document.clauses.length >= 2)
  const incidentalDocuments = documents.filter((document) => document.clauses.length === 1)

  const [liveDocuments, setLiveDocuments] = useState([])
  const [liveLoading, setLiveLoading] = useState(true)
  const [liveError, setLiveError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLiveLoading(true)
    setLiveError(null)
    listPolicyCitations(caseData?.companyId, caseData?.category)
      .then((entries) => {
        if (cancelled) return
        setLiveDocuments(groupByDocument(entries, t))
      })
      .catch((err) => {
        if (cancelled) return
        setLiveError(err.message)
      })
      .finally(() => {
        if (cancelled) return
        setLiveLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseData?.companyId, caseData?.category])

  async function handleOpen(policyId) {
    setError(null)
    setOpeningId(policyId)
    try {
      const url = await getPolicyDownloadUrl(policyId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err.message)
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <Card title={t('policyReferences.title')} description={t('policyReferences.description')} padded={false}>
      <div className="flex flex-col">
        <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('policyReferences.usedForCase')}
        </p>
        {documents.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState
              compact
              icon="document"
              title={t('policyReferences.empty.title')}
              description={t('policyReferences.empty.description')}
            />
          </div>
        ) : (
          <>
            {error && (
              <div className="px-5 pt-4">
                <Alert variant="error">{error}</Alert>
              </div>
            )}
            {primaryDocuments.length > 0 && (
              <ul className="divide-y divide-line-soft">
                {primaryDocuments.map((document) => (
                  <li key={document.policyId} className="flex flex-col gap-2 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-charcoal">{document.title}</p>
                        {document.version != null && (
                          <p className="text-xs text-muted">{t('policyReferences.version', { version: document.version })}</p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="document"
                        loading={openingId === document.policyId}
                        loadingLabel={t('policyReferences.opening')}
                        onClick={() => handleOpen(document.policyId)}
                      >
                        {t('policyReferences.openSource')}
                      </Button>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {document.clauses.map((clause) => (
                        <li key={clause.chunkId} className="text-xs text-muted">
                          {Array.isArray(clause.headingPath) && clause.headingPath.length > 0
                            ? clause.headingPath.join(' › ')
                            : t('policyReferences.unlabelledSection')}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {incidentalDocuments.length > 0 && (
              <div className="border-t border-line-soft px-5 py-4">
                <p className="text-xs font-medium text-muted">{t('policyReferences.alsoReferenced')}</p>
                <p className="text-xs text-muted/80">{t('policyReferences.alsoReferencedDescription')}</p>
                <ul className="mt-3 divide-y divide-line-soft/60">
                  {incidentalDocuments.map((document) => (
                    <li key={document.policyId} className="flex flex-col gap-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-normal text-xs text-muted">{document.title}</p>
                          {document.version != null && (
                            <p className="text-[11px] text-muted/80">{t('policyReferences.version', { version: document.version })}</p>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="document"
                          loading={openingId === document.policyId}
                          loadingLabel={t('policyReferences.opening')}
                          onClick={() => handleOpen(document.policyId)}
                        >
                          {t('policyReferences.openSource')}
                        </Button>
                      </div>
                      <ul className="flex flex-col gap-1">
                        {document.clauses.map((clause) => (
                          <li key={clause.chunkId} className="text-[11px] text-muted/80">
                            {Array.isArray(clause.headingPath) && clause.headingPath.length > 0
                              ? clause.headingPath.join(' › ')
                              : t('policyReferences.unlabelledSection')}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="px-5 py-3 text-xs text-muted">{t('policyReferences.footnote')}</p>
          </>
        )}

        <div className="border-t border-line-soft px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('policyReferences.allRelated')}</p>
          <p className="mt-1 text-xs text-muted/80">{t('policyReferences.allRelatedDescription')}</p>

          {liveLoading && (
            <p className="mt-3 text-xs text-muted">{t('common.loading')}</p>
          )}

          {!liveLoading && liveError && (
            <div className="mt-3">
              <Alert variant="error">{liveError}</Alert>
            </div>
          )}

          {!liveLoading && !liveError && liveDocuments.length === 0 && (
            <p className="mt-3 text-xs text-muted">{t('policyReferences.allRelatedEmpty')}</p>
          )}

          {!liveLoading && !liveError && liveDocuments.length > 0 && (
            <ul className="mt-3 divide-y divide-line-soft">
              {liveDocuments.map((document) => (
                <li key={document.policyId} className="flex flex-col gap-2 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-charcoal">{document.title}</p>
                      {document.version != null && (
                        <p className="text-xs text-muted">{t('policyReferences.version', { version: document.version })}</p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="document"
                      loading={openingId === document.policyId}
                      loadingLabel={t('policyReferences.opening')}
                      onClick={() => handleOpen(document.policyId)}
                    >
                      {t('policyReferences.openSource')}
                    </Button>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {document.clauses.map((clause) => (
                      <li key={clause.chunkId} className="text-xs text-muted">
                        {Array.isArray(clause.headingPath) && clause.headingPath.length > 0
                          ? clause.headingPath.join(' › ')
                          : t('policyReferences.unlabelledSection')}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}

export default PolicyReferences
