// DRAFT placeholder copy for the Privacy Policy page (src/pages/PrivacyPolicyPage.jsx).
//
// The SECTION LIST below (what topics exist and in what order) is the part
// meant to survive legal review - it was chosen to match what the product
// actually does: two reporting tiers with different collection, role-gated
// and logged access, one named AI sub-processor, tiered retention windows,
// and a real deletion-request path. The SENTENCES inside each section are
// placeholder text describing that behaviour in plain language, not legal
// language, and have not been reviewed by counsel. Nothing here should be
// treated as Rectifia's actual privacy commitment, cited to a regulator, or
// linked publicly as a final policy until `isDraft` below is flipped to
// `false` by whoever does that review.
//
// `policyVersion` is what functions/src/intake/submitCase.js stamps onto a
// case's dataHandlingAcknowledgment record (see
// src/components/intake/DataHandlingNotice.jsx) - it is the version string
// an auditor uses to answer "what exactly did this reporter see". Bump it to
// a new dated string every time the copy below changes, even a small edit,
// so an existing consent record stays attributable to the text a reporter
// actually read rather than whatever this file says today. Do not reuse a
// version string for two different sets of copy.
export const policyVersion = 'privacy-2026.08.07-draft1'

// Flip to false only once a lawyer has reviewed and approved the copy below
// for publication. This is the one flag that removes the draft banner from
// the rendered page - see PrivacyPolicyPage.jsx.
export const isDraft = true

export const lastUpdated = '2026-08-07'

export const draftNotice = {
  heading: 'This is a draft, not a published policy',
  body: [
    'The text below has not been reviewed by a lawyer. It describes how the product actually behaves today, written by the engineering team, so that a legal reviewer has something concrete to correct rather than a blank page. Do not rely on this page to answer a real data-subject request, and do not treat it as Rectifia’s final privacy commitment.',
  ],
}

// Structured sections: { heading, body[] }. Each item in `body` is either a
// paragraph (a string) or a bullet list (an array of strings) - see the
// rendering in PrivacyPolicyPage.jsx. Keeping the copy here, rather than in
// JSX, is what lets the lawyer-reviewed version replace this file wholesale
// without anyone touching the page component.
export const sections = [
  {
    heading: 'Overview',
    body: [
      'This policy covers the information Rectifia collects when you file a report, respond to a Pulse Check, or otherwise use the reporting parts of the product. It does not cover Rectifia’s own staff or its use of a company’s dashboard, which is a separate context with its own account and separate handling.',
      'Rectifia is provided to your employer (referred to below as "the company") to operate its reporting channel. Rectifia does not sell any of the information described below, to anyone, for any purpose.',
    ],
  },
  {
    heading: 'What we collect, by reporting tier',
    body: [
      'Every report collects the same baseline regardless of tier: the category you chose, your answers to the questionnaire for that category, the time the report was filed, and any messages or evidence you add afterwards through your case thread.',
      'You choose one of two identity tiers before your report is filed, and that choice changes what else is collected:',
      [
        '"Stay anonymous" - no name, email address, or phone number is collected at all, for this report, at any point. Nothing is stored blank or encrypted-but-present; the field simply does not exist on your case.',
        '"Confidential" - filing itself collects nothing extra; it only records your choice. If you later choose to identify yourself to your investigator, whatever details you provide (for example a name, email, or phone number) are encrypted before they are stored, and are never shown in plain text on any dashboard or in any report.',
      ],
      'Separately from the tier, you can optionally add a contact email address so you can be notified of updates to your case. This is stored encrypted and can be removed at any time from your case view; adding or removing it never changes your identity tier.',
      'If your employer uses Pulse Check, an anonymous well-being check-in is a separate flow with its own aggregation rules; individual Pulse Check answers are never shown to a Manager, only aggregates above a minimum-respondent floor.',
    ],
  },
  {
    heading: 'Who can access it, and under what logged authorization',
    body: [
      'Access to a case is role-gated, and every role sees only what its job requires:',
      [
        'The Case Handler assigned to your case can read its full content once it is assigned to them.',
        'An HR Coordinator can see case metadata for triage and routing (category, status, priority, deadlines) but not your questionnaire answers or message content.',
        'A Company Admin has no access to case content at all, by design - this is a conflict-of-interest control, since a Company Admin is often the person most likely to have a conflict with a report.',
        'A Manager or Pulse Check Reviewer only ever sees Pulse Check aggregates that have cleared the minimum-respondent floor, never an individual response.',
        'A Super Admin cannot read an encrypted identity or contact address by default. Decrypting one requires a documented legal reason and is recorded, every time, in an access log - there is no "read anything" mode.',
      ],
      'Every one of those reads or attempted reads is written to an audit log (separate logs cover identity decryption, staff-filed intake, unassigned-case triage, and privileged staff actions generally), so "who looked at this, and why" has an answer for every access, granted or denied.',
    ],
  },
  {
    heading: 'Sub-processors',
    body: [
      'A sub-processor is a third party we use to help provide the service. We currently use:',
      [
        'Anthropic - the text of your submitted report and follow-up messages is sent to Anthropic’s Claude models to score severity and evidence strength, suggest routing, generate optional follow-up questions, and (for Pulse Check) analyse sentiment. Anthropic processes this text on our behalf under a data processing agreement; case content is not used to train Anthropic’s general-purpose models under the terms of that agreement (exact contractual language to be confirmed and cited here by legal before publication).',
        'Google Cloud / Firebase - hosts the application, the database, file storage for evidence attachments, and authentication for staff accounts.',
      ],
      'AI processing informs a human decision; it does not make one. See the notice you saw before filing your report for how that applies to your case specifically.',
    ],
  },
  {
    heading: 'Retention periods and the deletion request path',
    body: [
      'Retention is tiered by what kind of data it is, and each window has a floor a company cannot go below regardless of its own settings, because employment-claim limitation periods can run for years after the events a case describes:',
      [
        'Identity and contact details (an encrypted name/email/phone, if any) - default 365 days, and can never be configured below 90 days.',
        'Case content (your answers, messages, evidence) - default 7 years from the case being closed (not from when it was filed), and can never be configured below 3 years.',
        'Pulse Check responses - default 2 years, floor 180 days.',
        'Audit logs (the access logs described above) - default 10 years, with no configurable ceiling, because there is no scenario where keeping an accountability record too long causes harm, only keeping one too short.',
      ],
      'To request deletion of your own report, open your case using your Case ID and passcode and use the deletion request option there. This does not delete anything automatically: because an anonymous reporter has no other way to prove who they are, and an open investigation may be under a legal obligation to be kept, a Case Handler reviews and approves or declines the request rather than it happening instantly. You will be able to see the outcome from your case view.',
    ],
  },
  {
    heading: 'Where your data is stored',
    body: [
      'Rectifia is hosted on Google Cloud infrastructure. The specific region(s) data is stored and processed in, and any regional restrictions offered to a company, are to be confirmed and stated here by legal/IT before this page is published - do not rely on this section for a data-residency commitment yet.',
    ],
  },
  {
    heading: 'Your rights',
    body: [
      'Regardless of jurisdiction, you can always:',
      [
        'Choose to remain anonymous, with nothing to request access to or erase for the fields that were simply never collected.',
        'Add or remove an optional contact email at any time from your case view.',
        'Ask what is on file for you - your case view shows which identity fields (if any) are stored, without needing a decrypt.',
        'Request deletion of your report using the path described above.',
      ],
      'Additional rights under laws such as the GDPR or CCPA (for example a formal right to access, correct, or port your data, and how to exercise it through a channel other than your case view) will be detailed here, with contact information for the relevant channel, once legal review is complete.',
    ],
  },
]
