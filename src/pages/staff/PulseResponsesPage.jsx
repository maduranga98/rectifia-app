import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IndividualResponsesView } from '../../components/pulse-check/PulseTrendDashboard'
import QuestionSetPreview from '../../components/pulse-check/QuestionSetPreview'
import { getPublishedQuestionSet } from '../../services/pulseQuestionService'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'

// Individual, named pulse-check responses and their AI sentiment summaries.
// The only roles that reach this page - HR Coordinator and Pulse Check
// Reviewer - are exactly the two firestore.rules grants a read path to
// pulseResponses; a wrong role's own data call is denied at the Firestore
// layer, not hidden here.
//
// Each response's answers are shown beside the questions that were actually put
// to that person, resolved through the response's own questionSetVersion. The
// preview below is the complementary half of the same idea: what the CURRENT
// check-in asks. Reading someone's answers without being able to see the
// questions is how a reader fills in the question themselves.
function PulseResponsesPage({ companyId }) {
  const { t } = useTranslation()
  const [questionSet, setQuestionSet] = useState(null)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    if (!companyId || !showPreview || questionSet) return
    let cancelled = false
    getPublishedQuestionSet(companyId)
      .then((result) => {
        if (!cancelled) setQuestionSet(result.published)
      })
      // Read-only context: a failure to load the preview must never take the
      // response list down with it, so it fails quietly and the panel simply
      // stays empty.
      .catch((err) => console.error('getPublishedQuestionSet failed', err))
    return () => {
      cancelled = true
    }
  }, [companyId, showPreview, questionSet])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <p className="max-w-2xl text-sm text-muted">{t('pulseResponsesPage.description')}</p>

      <Card
        title={t('pulseResponsesPage.whatItAsks.title')}
        description={t('pulseResponsesPage.whatItAsks.description')}
      >
        <div className="flex flex-col gap-4">
          <Button variant="secondary" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? t('pulseResponsesPage.hidePreview') : t('pulseResponsesPage.showCurrentCheckIn')}
          </Button>
          {showPreview && questionSet && <QuestionSetPreview questionSet={questionSet} />}
        </div>
      </Card>

      <IndividualResponsesView companyId={companyId} />
    </div>
  )
}

export default PulseResponsesPage
