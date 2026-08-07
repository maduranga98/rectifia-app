// DRAFT placeholder copy for the Terms of Use page (src/pages/TermsPage.jsx).
// See privacyPolicy.js's header comment for the full rationale: the section
// list is meant to survive legal review, the sentences inside each section
// are placeholder text describing actual product behaviour, not legal
// language, and none of it has been reviewed by counsel.
//
// `policyVersion` bumps independently of privacyPolicy.js's `policyVersion` -
// the two documents change on different schedules, and conflating their
// version strings would make a consent or acceptance record ambiguous about
// which document it actually refers to.
export const policyVersion = 'terms-2026.08.07-draft1'

// Flip to false only once a lawyer has reviewed and approved the copy below
// for publication.
export const isDraft = true

export const lastUpdated = '2026-08-07'

export const draftNotice = {
  heading: 'This is a draft, not a published policy',
  body: [
    'The text below has not been reviewed by a lawyer and must not be relied on as Rectifia’s actual terms of use, cited in a dispute, or linked publicly as final until this notice is removed.',
  ],
}

// Structured sections: { heading, body[] }, same shape as privacyPolicy.js.
export const sections = [
  {
    heading: 'What Rectifia is',
    body: [
      'Rectifia is a workplace reporting and case-management platform. Your employer (referred to below as "the company") licenses it to operate its reporting channel; Rectifia provides the software and processes the resulting reports on the company’s behalf.',
      'If you are a reporter using a /submit link, you are not creating an account and you are not a customer of Rectifia — these terms cover your use of the reporting and case-tracking pages themselves.',
    ],
  },
  {
    heading: 'Acceptance',
    body: [
      'By filing a report or responding to a Pulse Check, you agree to these terms and to the handling described in the Privacy Policy. If you do not agree, do not file a report through this link — you can still raise your concern through whatever other channel the company offers.',
    ],
  },
  {
    heading: 'No account, no guaranteed outcome',
    body: [
      'There is no sign-up and no password to this reporting flow — your Case ID and one-time passcode are your only credential, described further below.',
      'Filing a report does not guarantee any particular investigation outcome, timeline, or result. An AI system assists with scoring and routing your report, but it does not decide the outcome of your case; that is a human decision made by the handler assigned to it.',
      'This service is not legal advice, and using it is not a substitute for a formal grievance procedure, regulatory complaint, or legal claim where one is required or available to you — you may need to pursue those separately, and nothing here extends or shortens any deadline that applies to them.',
    ],
  },
  {
    heading: 'Your responsibilities as a reporter',
    body: [
      'You agree to provide information in good faith, to the best of your knowledge. Knowingly filing a false report may have consequences under the company’s own policies, separate from anything Rectifia does.',
      'This service is not an emergency or crisis line. If you are in immediate danger or crisis, use the emergency and crisis resources shown in the app (available at any time, without needing to acknowledge anything or answer any question first) rather than filing a report and waiting for a response.',
    ],
  },
  {
    heading: 'Your Case ID and passcode',
    body: [
      'Your Case ID and passcode are shown to you exactly once, at the moment you file. They are not sent to any email address, are not recoverable, and cannot be reset — the passcode is stored only as a one-way hash, and there is no account to prove ownership against. If you lose either one, you permanently lose access to that case and must file a new report to be heard again.',
      'You are responsible for keeping your Case ID and passcode somewhere only you can reach.',
    ],
  },
  {
    heading: 'Third-party processing',
    body: [
      'Report text is processed by a named AI sub-processor and the service is hosted on third-party cloud infrastructure, as described in full in the Privacy Policy.',
    ],
  },
  {
    heading: 'Limitation of liability',
    body: [
      'Placeholder — the specific limitation-of-liability language appropriate to this service and the jurisdictions it operates in is to be drafted by legal counsel before this page is published.',
    ],
  },
  {
    heading: 'Changes to these terms',
    body: [
      'These terms may be updated from time to time. Material changes will be reflected in a new `policyVersion` at the top of this file so a prior acceptance can be matched to the exact text it was given for.',
    ],
  },
  {
    heading: 'Governing law and contact',
    body: [
      'Placeholder — governing law/jurisdiction and a contact channel for questions about these terms are to be confirmed and stated here by legal before publication.',
    ],
  },
]
