import { useTranslation } from 'react-i18next'
import Card from '../../components/ui/Card'
import Icon from '../../components/ui/Icon'

// Static, role-scoped help content: what a role's own corner of Rectifia
// does and who to go to when this page doesn't answer it. Every role gets
// its own FAQ list and escalation text from helpSupport.roles.<role> in the
// locale files - there is nothing per-company or per-account here, so this
// needs no data fetch of its own, just the signed-in role.
//
// Not shown to Super Admin: that surface (src/pages/SuperAdminDashboardPage.jsx)
// has no nav shell of this kind and no role key in ROLES to key content off.
function FaqItem({ question, answer }) {
  return (
    <details className="group border-b border-line-soft py-3 last:border-b-0 first:pt-0 last:pb-0">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 text-sm font-medium text-charcoal marker:content-none [&::-webkit-details-marker]:hidden">
        <span>{question}</span>
        <Icon
          name="chevronRight"
          className="mt-0.5 h-4 w-4 shrink-0 text-subtle transition-transform group-open:rotate-90"
        />
      </summary>
      <p className="mt-2 text-sm text-muted">{answer}</p>
    </details>
  )
}

function HelpSupportPage({ role }) {
  const { t } = useTranslation()
  const intro = t(`helpSupport.roles.${role}.intro`)
  const faqs = t(`helpSupport.roles.${role}.faqs`, { returnObjects: true })
  const escalation = t(`helpSupport.roles.${role}.escalation`)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-500">
            <Icon name="help" className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted">{intro}</p>
        </div>
      </Card>

      <Card title={t('helpSupport.faqTitle')} padded={false}>
        <div className="px-5 py-2">
          {Array.isArray(faqs) &&
            faqs.map((faq) => <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />)}
        </div>
      </Card>

      <Card title={t('helpSupport.escalationTitle')}>
        <p className="text-sm text-muted">{escalation}</p>
      </Card>
    </div>
  )
}

export default HelpSupportPage
