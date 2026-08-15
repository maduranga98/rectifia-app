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
// The Sinhala (`si`) text is a plain-language translation of the same draft
// English copy, done for accessibility while the document is still in
// draft - it is not an independent legal translation, and both language
// versions need the same counsel review before `isDraft` is flipped.
//
// `policyVersion` is what functions/src/intake/submitCase.js stamps onto a
// case's dataHandlingAcknowledgment record (see
// src/components/intake/DataHandlingNotice.jsx) - it is the version string
// an auditor uses to answer "what exactly did this reporter see". Bump it to
// a new dated string every time the copy below changes, even a small edit,
// so an existing consent record stays attributable to the text a reporter
// actually read rather than whatever this file says today. Do not reuse a
// version string for two different sets of copy. The version string is
// shared across languages - it identifies the content the reporter
// acknowledged, not which language they read it in.
export const policyVersion = 'privacy-2026.08.07-draft1'

// Flip to false only once a lawyer has reviewed and approved the copy below
// for publication. This is the one flag that removes the draft banner from
// the rendered page - see PrivacyPolicyPage.jsx.
export const isDraft = true

export const lastUpdated = '2026-08-07'

// Structured sections: { heading, body[] }. Each item in `body` is either a
// paragraph (a string) or a bullet list (an array of strings) - see the
// rendering in PrivacyPolicyPage.jsx. Keeping the copy here, rather than in
// JSX, is what lets the lawyer-reviewed version replace this file wholesale
// without anyone touching the page component.
const CONTENT = {
  en: {
    draftNotice: {
      heading: 'This is a draft, not a published policy',
      body: [
        'The text below has not been reviewed by a lawyer. It describes how the product actually behaves today, written by the engineering team, so that a legal reviewer has something concrete to correct rather than a blank page. Do not rely on this page to answer a real data-subject request, and do not treat it as Rectifia’s final privacy commitment.',
      ],
    },
    sections: [
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
    ],
  },
  si: {
    draftNotice: {
      heading: 'මෙය කෙටුම්පතකි, ප්‍රකාශයට පත් කළ ප්‍රතිපත්තියක් නොවේ',
      body: [
        'පහත පෙළ නීතිඥයෙකු විසින් සමාලෝචනය කර නොමැත. එය නිෂ්පාදනය අද සැබවින්ම ක්‍රියා කරන ආකාරය විස්තර කරයි, ඉංජිනේරු කණ්ඩායම විසින් ලියා ඇති, එමගින් නෛතික සමාලෝචකයෙකුට හිස් පිටුවක් වෙනුවට නිවැරදි කිරීමට යමක් තිබේ. සැබෑ දත්ත-විෂය ඉල්ලීමකට පිළිතුරු දීමට මෙම පිටුව මත රඳා නොසිටින්න, සහ එය Rectifia හි අවසාන පෞද්ගලිකත්ව කැපවීම ලෙස නොසලකන්න.',
      ],
    },
    sections: [
      {
        heading: 'දළ විශ්ලේෂණය',
        body: [
          'ඔබ වාර්තාවක් ගොනු කරන විට, Pulse Check එකකට ප්‍රතිචාර දක්වන විට, හෝ නිෂ්පාදනයේ වාර්තාකරණ කොටස් වෙනත් ආකාරයකින් භාවිත කරන විට Rectifia විසින් රැස් කරන තොරතුරු මෙම ප්‍රතිපත්තිය ආවරණය කරයි. එය Rectifia හි කාර්ය මණ්ඩලය හෝ සමාගමක උපකරණ පුවරුව භාවිතය ආවරණය නොකරයි, එය තමන්ගේම ගිණුමක් හා වෙනම හැසිරවීමක් සහිත වෙනම සන්දර්භයකි.',
          'Rectifia ඔබගේ සේවායෝජකයාට (පහත "සමාගම" ලෙස හඳුන්වනු ලැබේ) එහි වාර්තාකරණ නාලිකාව ක්‍රියාත්මක කිරීම සඳහා සපයනු ලැබේ. Rectifia පහත විස්තර කර ඇති කිසිදු තොරතුරක් කිසිවෙකුට, කිසිදු අරමුණක් සඳහා විකුණන්නේ නැත.',
        ],
      },
      {
        heading: 'වාර්තාකරණ ස්තරය අනුව අප රැස් කරන දේ',
        body: [
          'ස්තරය කුමක් වුවත් සෑම වාර්තාවක්ම එකම මූලික දත්ත රැස් කරයි: ඔබ තෝරාගත් වර්ගය, එම වර්ගය සඳහා ප්‍රශ්නාවලියට ඔබගේ පිළිතුරු, වාර්තාව ගොනු කළ වේලාව, සහ පසුව ඔබගේ නඩු පණිවිඩ මාලාව හරහා ඔබ එකතු කරන ඕනෑම පණිවිඩයක් හෝ සාක්ෂියක්.',
          'ඔබගේ වාර්තාව ගොනු කිරීමට පෙර ඔබ අනන්‍යතා ස්තර දෙකෙන් එකක් තෝරා ගනී, එම තේරීම වෙනත් කුමක් රැස් කරන්නේද යන්න වෙනස් කරයි:',
          [
            '"නිර්නාමිකව සිටින්න" - මෙම වාර්තාව සඳහා කිසිම අවස්ථාවක නමක්, විද්‍යුත් තැපැල් ලිපිනයක්, හෝ දුරකථන අංකයක් කිසිසේත් රැස් නොකෙරේ. කිසිවක් හිස්ව හෝ සංකේතනය කර-නමුත්-පවතින ලෙස ගබඩා නොකෙරේ; එම ක්ෂේත්‍රය ඔබගේ නඩුවේ සරලවම නොපවතී.',
            '"රහසිගත" - ගොනු කිරීමම අමතර කිසිවක් රැස් නොකරයි; එය ඔබගේ තේරීම පමණක් වාර්තා කරයි. ඔබ පසුව ඔබගේ විමර්ශකයාට ඔබව හඳුන්වා දීමට තෝරා ගන්නේ නම්, ඔබ සපයන ඕනෑම විස්තරයක් (උදාහරණයක් ලෙස නමක්, විද්‍යුත් තැපෑලක්, හෝ දුරකථන අංකයක්) ගබඩා කිරීමට පෙර සංකේතනය කෙරෙන අතර, කිසිදු උපකරණ පුවරුවක හෝ වාර්තාවක සරල පෙළින් කිසිවිටෙක නොපෙන්වයි.',
          ],
          'ස්තරයෙන් වෙන්ව, ඔබගේ නඩුවේ යාවත්කාලීන පිළිබඳව දැනුම් දීමට හැකි වන පරිදි විකල්පයක් ලෙස සම්බන්ධතා විද්‍යුත් තැපැල් ලිපිනයක් එකතු කළ හැක. මෙය සංකේතනය කර ගබඩා කර ඇති අතර ඕනෑම වේලාවක ඔබගේ නඩු දසුනෙන් ඉවත් කළ හැක; එය එකතු කිරීම හෝ ඉවත් කිරීම ඔබගේ අනන්‍යතා ස්තරය කිසිවිටෙක වෙනස් නොකරයි.',
          'ඔබගේ සේවායෝජකයා Pulse Check භාවිත කරන්නේ නම්, නිර්නාමික සුවතා පරීක්ෂණය එහිම සමස්ත කිරීමේ නීති සහිත වෙනම ප්‍රවාහයකි; තනි Pulse Check පිළිතුරු කළමනාකරුවෙකුට කිසිවිටෙක නොපෙන්වයි, අවම ප්‍රතිචාරක සීමාවකට වඩා වැඩි සමස්ත ප්‍රතිඵල පමණි.',
        ],
      },
      {
        heading: 'එයට ප්‍රවේශ විය හැක්කේ කාටද, කුමන වාර්තාගත බලයක් යටතේද',
        body: [
          'නඩුවකට ප්‍රවේශය භූමිකා අනුව ගේට්ටු කර ඇති අතර, සෑම භූමිකාවක්ම එහි රැකියාවට අවශ්‍ය දේ පමණක් දකියි:',
          [
            'ඔබගේ නඩුවට පවරා ඇති නඩු හසුරුවන්නාට එය පවරන ලද පසු එහි සම්පූර්ණ අන්තර්ගතය කියවිය හැක.',
            'HR සම්බන්ධීකාරකවරයෙකුට වර්ග කිරීම සහ මාර්ග යැවීම සඳහා නඩු පශ්චාත් දත්ත (වර්ගය, තත්ත්වය, ප්‍රමුඛතාව, කාලසීමා) දැකිය හැකි නමුත් ඔබගේ ප්‍රශ්නාවලි පිළිතුරු හෝ පණිවිඩ අන්තර්ගතය නොවේ.',
            'සමාගම් පරිපාලකයෙකුට නඩු අන්තර්ගතයට කිසිසේත් ප්‍රවේශයක් නොමැත, එය සැලසුම් කර ඇති ආකාරයයි - මෙය අවශ්‍ය-දැනගැනීම-පදනම් පාලනයකි, මන්ද සමාගම් පරිපාලකයෙකු බොහෝ විට වාර්තාවක් සමඟ ගැටුමක් ඇති විය හැකි තැනැත්තා විය හැකි බැවිනි.',
            'කළමනාකරුවෙකු හෝ Pulse Check සමාලෝචකයෙකු අවම ප්‍රතිචාරක සීමාව සම්මත වූ Pulse Check සමස්ත ප්‍රතිඵල පමණක් දකියි, කිසිවිටෙක තනි පිළිතුරක් නොවේ.',
            'සුපිරි පරිපාලකයෙකුට පෙරනිමියෙන් සංකේතනය කළ අනන්‍යතාවක් හෝ සම්බන්ධතා ලිපිනයක් කියවිය නොහැක. එකක් විසංකේතනය කිරීමට වාර්තාගත නෛතික හේතුවක් අවශ්‍ය වන අතර සෑම විටම ප්‍රවේශ වාර්තාවක සටහන් වේ - "ඕනෑම දෙයක් කියවීමේ" ආකාරයක් නොපවතී.',
          ],
          'එම එක් එක් කියවීම් හෝ කියවීමට කළ උත්සාහයන් විගණන වාර්තාවක සටහන් වේ (වෙනම වාර්තා අනන්‍යතා විසංකේතනය, කාර්ය මණ්ඩලය විසින් ගොනු කරන ලද ප්‍රවේශය, පවරා නොමැති-නඩු වර්ග කිරීම, සහ පොදුවේ වරප්‍රසාද සහිත කාර්ය මණ්ඩල ක්‍රියා ආවරණය කරයි), එබැවින් සෑම ප්‍රවේශයකටම, ලබා දුන් හෝ ප්‍රතික්ෂේප කළ, "මෙය බැලුවේ කවුරුන්ද, ඇයි" යන්නට පිළිතුරක් ඇත.',
        ],
      },
      {
        heading: 'උප-සකසන්නන්',
        body: [
          'උප-සකසන්නෙකු යනු අප සේවාව සැපයීමට උදව් කිරීමට භාවිත කරන තෙවන පාර්ශවයකි. අප දැනට භාවිත කරන්නේ:',
          [
            'Anthropic - ඔබ ඉදිරිපත් කළ වාර්තාවේ සහ පසු විපරම් පණිවිඩවල පෙළ, බරපතලකම සහ සාක්ෂි ශක්තිය ලකුණු කිරීමට, මාර්ග යැවීම යෝජනා කිරීමට, විකල්ප පසු විපරම් ප්‍රශ්න ජනනය කිරීමට, සහ (Pulse Check සඳහා) හැඟීම් විශ්ලේෂණය කිරීමට Anthropic හි Claude ආකෘති වෙත යවනු ලැබේ. Anthropic දත්ත සැකසුම් ගිවිසුමක් යටතේ අප වෙනුවෙන් මෙම පෙළ සකසයි; එම ගිවිසුමේ කොන්දේසි යටතේ නඩු අන්තර්ගතය Anthropic හි පොදු-අරමුණු ආකෘති පුහුණු කිරීමට භාවිත නොකෙරේ (නිශ්චිත ගිවිසුම් භාෂාව ප්‍රකාශයට පත් කිරීමට පෙර නීතිඥවරයෙකු විසින් තහවුරු කර මෙහි උපුටා දැක්විය යුතුය).',
            'Google Cloud / Firebase - යෙදුම, දත්ත සමුදාය, සාක්ෂි ඇමුණුම් සඳහා ගොනු ගබඩාව, සහ කාර්ය මණ්ඩල ගිණුම් සඳහා සත්‍යාපනය සත්කාරකත්වය සපයයි.',
          ],
          'AI සැකසීම මානව තීරණයකට තොරතුරු සපයයි; එය තීරණයක් ගන්නේ නැත. එය ඔබගේ නඩුවට විශේෂයෙන් අදාළ වන ආකාරය සඳහා ඔබගේ වාර්තාව ගොනු කිරීමට පෙර ඔබ දුටු දැන්වීම බලන්න.',
        ],
      },
      {
        heading: 'රඳවා තබා ගැනීමේ කාල පරිච්ඡේද සහ මකා දැමීමේ ඉල්ලීමේ මාර්ගය',
        body: [
          'රඳවා තබා ගැනීම දත්ත වර්ගය අනුව ස්තර වශයෙන් වන අතර, සේවා-හිමිකම් සීමා කාල පරිච්ඡේද නඩුවක් විස්තර කරන සිදුවීම් වලින් වසර ගණනාවක් ගතවීමෙන් පසුවත් ක්‍රියාත්මක විය හැකි බැවින්, සමාගමකට එහිම සැකසුම් කුමක් වුවත් පහළට යා නොහැකි අවම සීමාවක් සෑම කාලයකටම ඇත:',
          [
            'අනන්‍යතාව සහ සම්බන්ධතා විස්තර (සංකේතනය කළ නම/විද්‍යුත් තැපෑල/දුරකථනය, ඇත්නම්) - පෙරනිමිය දින 365, සහ කිසිවිටෙක දින 90 ට වඩා අඩුවෙන් වින්‍යාස කළ නොහැක.',
            'නඩු අන්තර්ගතය (ඔබගේ පිළිතුරු, පණිවිඩ, සාක්ෂි) - නඩුව වසා දැමූ දින සිට (ගොනු කළ දින සිට නොව) පෙරනිමිය වසර 7ක්, සහ කිසිවිටෙක වසර 3 ට වඩා අඩුවෙන් වින්‍යාස කළ නොහැක.',
            'Pulse Check පිළිතුරු - පෙරනිමිය වසර 2ක්, අවම සීමාව දින 180.',
            'විගණන වාර්තා (ඉහත විස්තර කළ ප්‍රවේශ වාර්තා) - පෙරනිමිය වසර 10ක්, වින්‍යාස කළ හැකි උපරිමයක් නොමැතිව, මන්ද වගවීමේ වාර්තාවක් අධික කාලයක් තබා ගැනීම හානියක් ඇති කරන අවස්ථාවක් නොමැති අතර, එය ඉතා කෙටි කාලයක් තබා ගැනීම පමණක් හානිකර වන බැවිනි.',
          ],
          'ඔබගේම වාර්තාව මකා දැමීමට ඉල්ලීමට, ඔබගේ නඩු අංකය සහ රහස් අංකය භාවිතයෙන් ඔබගේ නඩුව විවෘත කර එහි ඇති මකාදැමීමේ ඉල්ලීමේ විකල්පය භාවිත කරන්න. මෙය ස්වයංක්‍රීයව කිසිවක් මකා නොදමයි: නිර්නාමික වාර්තාකරුවෙකුට තමන් කවුරුන්දැයි ඔප්පු කිරීමට වෙනත් ක්‍රමයක් නොමැති බැවින්, සහ විවෘත විමර්ශනයක් තබා ගැනීමට නෛතික බැඳීමක් යටතේ තිබිය හැකි බැවින්, එය ක්ෂණිකව සිදු වීමට වඩා නඩු හසුරුවන්නෙකු ඉල්ලීම සමාලෝචනය කර අනුමත කරයි හෝ ප්‍රතික්ෂේප කරයි. ප්‍රතිඵලය ඔබගේ නඩු දසුනෙන් දැකගත හැකි වේ.',
        ],
      },
      {
        heading: 'ඔබගේ දත්ත ගබඩා කර ඇත්තේ කොහෙද',
        body: [
          'Rectifia Google Cloud යටිතල පහසුකම් මත සත්කාරකත්වය දරයි. දත්ත ගබඩා කර සකසනු ලබන නිශ්චිත කලාපය(ය), සහ සමාගමකට ලබා දෙන ඕනෑම කලාපීය සීමාවක්, මෙම පිටුව ප්‍රකාශයට පත් කිරීමට පෙර නීති/IT අංශය විසින් තහවුරු කර මෙහි සඳහන් කළ යුතුය - දත්ත-පදිංචිය පිළිබඳ කැපවීමක් සඳහා තවම මෙම කොටස මත රඳා නොසිටින්න.',
        ],
      },
      {
        heading: 'ඔබගේ අයිතිවාසිකම්',
        body: [
          'අධිකරණ බලප්‍රදේශය කුමක් වුවත්, ඔබට සැමවිටම හැකිය:',
          [
            'නිර්නාමිකව සිටීමට තෝරා ගැනීමට, කිසිසේත් රැස් නොකළ ක්ෂේත්‍ර සඳහා ප්‍රවේශය ඉල්ලීමට හෝ මකා දැමීමට කිසිවක් නොමැතිව.',
            'ඔබගේ නඩු දසුනෙන් ඕනෑම වේලාවක විකල්ප සම්බන්ධතා විද්‍යුත් තැපෑලක් එකතු කිරීමට හෝ ඉවත් කිරීමට.',
            'ඔබ සඳහා ගොනු කර ඇත්තේ කුමක්දැයි විමසීමට - ඔබගේ නඩු දසුන විසංකේතනයක් අවශ්‍ය නොවී කුමන අනන්‍යතා ක්ෂේත්‍ර (ඇත්නම්) ගබඩා කර ඇත්දැයි පෙන්වයි.',
            'ඉහත විස්තර කළ මාර්ගය භාවිතයෙන් ඔබගේ වාර්තාව මකා දැමීමට ඉල්ලීමට.',
          ],
          'GDPR හෝ CCPA වැනි නීති යටතේ අමතර අයිතිවාසිකම් (උදාහරණයක් ලෙස ඔබගේ දත්ත වෙත ප්‍රවේශ වීමට, නිවැරදි කිරීමට, හෝ ලබා ගැනීමට විධිමත් අයිතියක්, සහ ඔබගේ නඩු දසුනට වඩා වෙනත් නාලිකාවක් හරහා එය ක්‍රියාත්මක කරන ආකාරය) නෛතික සමාලෝචනය සම්පූර්ණ වූ පසු, අදාළ නාලිකාව සඳහා සම්බන්ධතා තොරතුරු සමඟ මෙහි විස්තර කෙරෙනු ඇත.',
        ],
      },
    ],
  },
}

// Returns the content for `lang`, falling back to English for an
// unsupported or missing language code - the same fallback i18next itself
// uses (see src/services/i18n.js's fallbackLng).
export function getPrivacyPolicyContent(lang) {
  return CONTENT[lang] ?? CONTENT.en
}
