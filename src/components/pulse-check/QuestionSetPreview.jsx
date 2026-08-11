import { useTranslation } from 'react-i18next'
import PulseSurveyForm from './PulseSurveyForm'
import Alert from '../ui/Alert'
import Badge from '../ui/Badge'

// The questionnaire exactly as employees receive it, with submission disabled.
//
// This deliberately renders the REAL PulseSurveyForm rather than a mock-up of
// it. A preview built from a second, simplified renderer is a preview of the
// preview: it drifts, and the first person to notice is an employee looking at
// something the admin never saw. The only difference here is `preview`, which
// disables the submit button and shows the banner.
//
// No inviteId and no token are passed, so even if the disabled button were
// somehow activated, submitPulseResponse has no credential to spend - there are
// two independent reasons nothing can be recorded, not one.
function QuestionSetPreview({ questionSet, companyName, unpublishedChanges = false, className = '' }) {
  const { t } = useTranslation()
  const version = questionSet?.version
  const supplementaryCount = (questionSet?.questions ?? []).filter(
    (q) => q.tier === 'supplementary'
  ).length

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="tone-neutral">
          {version
            ? t('questionSetPreview.publishedVersion', { version })
            : t('questionSetPreview.standardOnly')}
        </Badge>
        <span className="text-xs text-muted">
          {supplementaryCount === 0
            ? t('questionSetPreview.noAddedQuestions')
            : t('questionSetPreview.addedQuestions', { count: supplementaryCount })}
        </span>
      </div>

      {unpublishedChanges && (
        <Alert variant="warning" title={t('questionSetPreview.liveVersion.title')}>
          {t('questionSetPreview.liveVersion.body')}
        </Alert>
      )}

      <PulseSurveyForm preview questionSet={questionSet} companyName={companyName} />
    </div>
  )
}

export default QuestionSetPreview
