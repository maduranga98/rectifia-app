import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReporterLayout from '../components/shared/ReporterLayout'
import Alert from '../components/ui/Alert'
import Card from '../components/ui/Card'
import Icon from '../components/ui/Icon'

// What a signed-out visitor gets at "/" (and at any unknown URL). Previously
// they were sent straight to the staff login page, which offers a reporter
// nothing at all - no way back into a case they already filed, and no
// explanation of why there is no report button.
//
// This is a dispatcher, not a homepage: two routes out, and the one sentence
// a reporter needs to understand why filing starts somewhere else. It
// deliberately has nothing to sell.
//
// Note what is absent by design: no company picker, no slug field, no search.
// Reports are company-scoped by slug, and anything that resolved a typed name
// here would answer "is <employer> a Rectifia customer?" to anyone who asked.
// The reporting link the employer published is the only way in, and that is
// the point rather than a gap.
function PublicEntryPage() {
  const { t } = useTranslation()

  return (
    <ReporterLayout
      title={t('publicEntry.title')}
      description={t('publicEntry.description')}
    >
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy">
                <Icon name="search" className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-charcoal">
                  {t('reporterLayout.trackExisting')}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {t('publicEntry.trackCard.body')}
                </p>
              </div>
            </div>
            <Link to="/case" className="btn btn-primary self-start">
              {t('reporterLayout.trackExisting')}
            </Link>
          </div>
        </Card>

        <Alert variant="info" title={t('publicEntry.alert.title')}>
          {t('publicEntry.alert.body')}
        </Alert>

        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy">
                <Icon name="shield" className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-charcoal">{t('publicEntry.staffCard.title')}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {t('publicEntry.staffCard.body')}
                </p>
              </div>
            </div>
            <Link to="/login" className="btn btn-secondary self-start">
              {t('publicEntry.staffCard.title')}
            </Link>
          </div>
        </Card>

        <p className="text-xs leading-relaxed text-muted">{t('publicEntry.lostCredentials')}</p>
      </div>
    </ReporterLayout>
  )
}

export default PublicEntryPage
