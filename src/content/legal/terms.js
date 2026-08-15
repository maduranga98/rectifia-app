// DRAFT placeholder copy for the Terms of Use page (src/pages/TermsPage.jsx).
// See privacyPolicy.js's header comment for the full rationale: the section
// list is meant to survive legal review, the sentences inside each section
// are placeholder text describing actual product behaviour, not legal
// language, and none of it has been reviewed by counsel. The Sinhala (`si`)
// text below is a plain-language translation of the same draft, not an
// independent legal translation - both languages need the same counsel
// review before `isDraft` is flipped.
//
// `policyVersion` bumps independently of privacyPolicy.js's `policyVersion` -
// the two documents change on different schedules, and conflating their
// version strings would make a consent or acceptance record ambiguous about
// which document it actually refers to. The version string is shared across
// languages - it identifies the content, not which language it was read in.
export const policyVersion = 'terms-2026.08.07-draft1'

// Flip to false only once a lawyer has reviewed and approved the copy below
// for publication.
export const isDraft = true

export const lastUpdated = '2026-08-07'

// Structured sections: { heading, body[] }, same shape as privacyPolicy.js.
const CONTENT = {
  en: {
    draftNotice: {
      heading: 'This is a draft, not a published policy',
      body: [
        'The text below has not been reviewed by a lawyer and must not be relied on as Rectifia’s actual terms of use, cited in a dispute, or linked publicly as final until this notice is removed.',
      ],
    },
    sections: [
      {
        heading: 'What Rectifia is',
        body: [
          'Rectifia is a workplace reporting and case-management platform. Your employer (referred to below as "the company") licenses it to operate its reporting channel; Rectifia provides the software and processes the resulting reports on the company’s behalf.',
          'If you are a reporter using a /submit link, you are not creating an account and you are not a customer of Rectifia - these terms cover your use of the reporting and case-tracking pages themselves.',
        ],
      },
      {
        heading: 'Acceptance',
        body: [
          'By filing a report or responding to a Pulse Check, you agree to these terms and to the handling described in the Privacy Policy. If you do not agree, do not file a report through this link - you can still raise your concern through whatever other channel the company offers.',
        ],
      },
      {
        heading: 'No account, no guaranteed outcome',
        body: [
          'There is no sign-up and no password to this reporting flow - your Case ID and one-time passcode are your only credential, described further below.',
          'Filing a report does not guarantee any particular investigation outcome, timeline, or result. An AI system assists with scoring and routing your report, but it does not decide the outcome of your case; that is a human decision made by the handler assigned to it.',
          'This service is not legal advice, and using it is not a substitute for a formal grievance procedure, regulatory complaint, or legal claim where one is required or available to you - you may need to pursue those separately, and nothing here extends or shortens any deadline that applies to them.',
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
          'Your Case ID and passcode are shown to you exactly once, at the moment you file. They are not sent to any email address, are not recoverable, and cannot be reset - the passcode is stored only as a one-way hash, and there is no account to prove ownership against. If you lose either one, you permanently lose access to that case and must file a new report to be heard again.',
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
          'Placeholder - the specific limitation-of-liability language appropriate to this service and the jurisdictions it operates in is to be drafted by legal counsel before this page is published.',
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
          'Placeholder - governing law/jurisdiction and a contact channel for questions about these terms are to be confirmed and stated here by legal before publication.',
        ],
      },
    ],
  },
  si: {
    draftNotice: {
      heading: 'මෙය කෙටුම්පතකි, ප්‍රකාශයට පත් කළ ප්‍රතිපත්තියක් නොවේ',
      body: [
        'පහත පෙළ නීතිඥයෙකු විසින් සමාලෝචනය කර නොමැති අතර, මෙම දැන්වීම ඉවත් කරන තෙක් Rectifia හි සැබෑ භාවිත කොන්දේසි ලෙස රඳා නොසිටිය යුතුය, ආරවුලක උපුටා දක්විය නොහැක, හෝ අවසන් ලෙස ප්‍රසිද්ධියේ සම්බන්ධ කළ නොහැක.',
      ],
    },
    sections: [
      {
        heading: 'Rectifia යනු කුමක්ද',
        body: [
          'Rectifia යනු කාර්යස්ථාන වාර්තාකරණ හා නඩු කළමනාකරණ වේදිකාවකි. ඔබගේ සේවායෝජකයා (පහත "සමාගම" ලෙස හඳුන්වනු ලැබේ) එහි වාර්තාකරණ නාලිකාව ක්‍රියාත්මක කිරීම සඳහා එයට බලපත්‍රය ලබා දෙයි; Rectifia මෘදුකාංගය සපයන අතර සමාගම වෙනුවෙන් ලැබෙන වාර්තා සකසයි.',
          'ඔබ /submit සබැඳියක් භාවිත කරන වාර්තාකරුවෙකු නම්, ඔබ ගිණුමක් නිර්මාණය කරන්නේ නැත සහ ඔබ Rectifia හි පාරිභෝගිකයෙකු නොවේ - මෙම කොන්දේසි වාර්තාකරණ සහ නඩු-හඹා යාමේ පිටු භාවිතයම ආවරණය කරයි.',
        ],
      },
      {
        heading: 'පිළිගැනීම',
        body: [
          'වාර්තාවක් ගොනු කිරීමෙන් හෝ Pulse Check එකකට ප්‍රතිචාර දැක්වීමෙන්, ඔබ මෙම කොන්දේසිවලට සහ පෞද්ගලිකත්ව ප්‍රතිපත්තියේ විස්තර කර ඇති හැසිරවීමට එකඟ වේ. ඔබ එකඟ නොවේ නම්, මෙම සබැඳිය හරහා වාර්තාවක් ගොනු නොකරන්න - සමාගම ලබා දෙන වෙනත් ඕනෑම නාලිකාවක් හරහා ඔබට තවමත් ඔබගේ කනස්සල්ල මතු කළ හැක.',
        ],
      },
      {
        heading: 'ගිණුමක් නැත, සහතික කළ ප්‍රතිඵලයක් නැත',
        body: [
          'මෙම වාර්තාකරණ ප්‍රවාහයට ලියාපදිංචියක් හෝ මුරපදයක් නොමැත - ඔබගේ නඩු අංකය සහ එක්-වර රහස් අංකය ඔබගේ එකම අක්තපත්‍රයයි, පහත වැඩිදුර විස්තර කර ඇත.',
          'වාර්තාවක් ගොනු කිරීම විශේෂිත විමර්ශන ප්‍රතිඵලයක්, කාලසටහනක්, හෝ ප්‍රතිඵලයක් සහතික නොකරයි. AI පද්ධතියක් ඔබගේ වාර්තාව ලකුණු කිරීමට සහ මාර්ග යැවීමට උදව් කරයි, නමුත් එය ඔබගේ නඩුවේ ප්‍රතිඵලය තීරණය නොකරයි; එය එයට පවරා ඇති හසුරුවන්නා විසින් ගනු ලබන මානව තීරණයකි.',
          'මෙම සේවාව නෛතික උපදෙස් නොවේ, සහ එය භාවිතය විධිමත් පැමිණිලි ක්‍රියාපටිපාටියකට, නියාමන පැමිණිල්ලකට, හෝ නෛතික හිමිකම් පෑමකට ආදේශකයක් නොවේ, එවැන්නක් ඔබට අවශ්‍ය හෝ ලබාගත හැකි වන විට - ඔබට ඒවා වෙනම කරගෙන යාමට සිදුවිය හැක, සහ ඒවාට අදාළ කිසිදු කාලසීමාවක් මෙහි කිසිවක් දිගු කිරීමක් හෝ කෙටි කිරීමක් නොකරයි.',
        ],
      },
      {
        heading: 'වාර්තාකරුවෙකු ලෙස ඔබගේ වගකීම්',
        body: [
          'ඔබගේ දැනුමට හැකි උපරිමයෙන්, යහපත් විශ්වාසයෙන් තොරතුරු සැපයීමට ඔබ එකඟ වේ. දැනුවත්වම බොරු වාර්තාවක් ගොනු කිරීම Rectifia කරන ඕනෑම දෙයකින් වෙන්ව, සමාගමේම ප්‍රතිපත්ති යටතේ ප්‍රතිවිපාක ඇති කළ හැක.',
          'මෙම සේවාව හදිසි හෝ අර්බුද මාර්ගයක් නොවේ. ඔබ ක්ෂණික අනතුරක හෝ අර්බුදයක සිටී නම්, වාර්තාවක් ගොනු කර ප්‍රතිචාරයක් සඳහා රැඳී සිටීමට වඩා යෙදුමේ පෙන්වා ඇති හදිසි සහ අර්බුද සම්පත් (කිසිවක් පිළිගැනීමට හෝ පළමුව කිසිදු ප්‍රශ්නයකට පිළිතුරු දීමට අවශ්‍ය නොවී ඕනෑම වේලාවක ලබාගත හැකි) භාවිත කරන්න.',
        ],
      },
      {
        heading: 'ඔබගේ නඩු අංකය සහ රහස් අංකය',
        body: [
          'ඔබගේ නඩු අංකය සහ රහස් අංකය ඔබ ගොනු කරන මොහොතේ, ඔබට හරියටම එක් වරක් පෙන්වනු ලැබේ. ඒවා කිසිදු විද්‍යුත් තැපැල් ලිපිනයකට යවනු නොලැබේ, ප්‍රතිසාධනය කළ නොහැක, සහ යළි පිහිටුවිය නොහැක - රහස් අංකය එක්-මාර්ග හැෂ් එකක් ලෙස පමණක් ගබඩා කර ඇති අතර, හිමිකාරිත්වය තහවුරු කිරීමට ගිණුමක් නොමැත. ඔබ ඕනෑම එකක් අහිමි කර ගතහොත්, ඔබට එම නඩුවට ප්‍රවේශය ස්ථිරවම අහිමි වන අතර නැවත ඇසීමට නව වාර්තාවක් ගොනු කළ යුතුය.',
          'ඔබගේ නඩු අංකය සහ රහස් අංකය ඔබට පමණක් ළඟා විය හැකි ස්ථානයක තබා ගැනීමට ඔබ වගකිව යුතුය.',
        ],
      },
      {
        heading: 'තෙවන පාර්ශව සැකසීම',
        body: [
          'වාර්තා පෙළ නම් කරන ලද AI උප-සකසන්නෙකු විසින් සකසනු ලබන අතර සේවාව තෙවන පාර්ශව සමූහ යටිතල පහසුකම් මත සත්කාරකත්වය දරයි, පෞද්ගලිකත්ව ප්‍රතිපත්තියේ සම්පූර්ණයෙන් විස්තර කර ඇති පරිදි.',
        ],
      },
      {
        heading: 'වගකීමේ සීමාව',
        body: [
          'ස්ථානාපන්නය - මෙම සේවාවට සහ එය ක්‍රියාත්මක වන අධිකරණ බලප්‍රදේශවලට සුදුසු නිශ්චිත වගකීම්-සීමා කිරීමේ භාෂාව මෙම පිටුව ප්‍රකාශයට පත් කිරීමට පෙර නීති උපදේශකයෙකු විසින් කෙටුම්පත් කළ යුතුය.',
        ],
      },
      {
        heading: 'මෙම කොන්දේසිවලට වෙනස්කම්',
        body: [
          'මෙම කොන්දේසි කලින් කලට යාවත්කාලීන කළ හැක. සැලකිය යුතු වෙනස්කම් මෙම ගොනුවේ ඉහළින් ඇති නව `policyVersion` හි පිළිබිඹු වනු ඇති අතර, එමගින් පෙර පිළිගැනීමක් එය ලබා දුන් නිශ්චිත පෙළ සමඟ ගැලපිය හැක.',
        ],
      },
      {
        heading: 'පාලක නීතිය සහ සම්බන්ධතාව',
        body: [
          'ස්ථානාපන්නය - පාලක නීතිය/අධිකරණ බලප්‍රදේශය සහ මෙම කොන්දේසි පිළිබඳ ප්‍රශ්න සඳහා සම්බන්ධතා නාලිකාවක් ප්‍රකාශයට පත් කිරීමට පෙර නීති අංශය විසින් තහවුරු කර මෙහි සඳහන් කළ යුතුය.',
        ],
      },
    ],
  },
}

// Returns the content for `lang`, falling back to English for an
// unsupported or missing language code - the same fallback i18next itself
// uses (see src/services/i18n.js's fallbackLng).
export function getTermsContent(lang) {
  return CONTENT[lang] ?? CONTENT.en
}
