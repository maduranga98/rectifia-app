import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPolicyDownloadUrl } from '../../services/policyService'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Card from '../ui/Card'
import EmptyState from '../ui/EmptyState'

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
  const byDocument = citations.reduce((acc, citation) => {
    const key = citation.policyId
    if (!key) return acc
    if (!acc[key]) {
      acc[key] = {
        policyId: citation.policyId,
        title: citation.title ?? t('policyReferences.policyDocument'),
        version: citation.version ?? null,
        clauses: [],
      }
    }
    acc[key].clauses.push(citation)
    return acc
  }, {})
  const documents = Object.values(byDocument)

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
    <Card
      title={t('policyReferences.title')}
      description={t('policyReferences.description')}
      padded={documents.length === 0}
    >
      {documents.length === 0 ? (
        <EmptyState
          compact
          icon="document"
          title={t('policyReferences.empty.title')}
          description={t('policyReferences.empty.description')}
        />
      ) : (
        <div className="flex flex-col">
          {error && (
            <div className="px-5 pt-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}
          <ul className="divide-y divide-line-soft">
            {documents.map((document) => (
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
          <p className="px-5 py-3 text-xs text-muted">{t('policyReferences.footnote')}</p>
        </div>
      )}
    </Card>
  )
}

export default PolicyReferences
