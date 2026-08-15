import { regionFromTimeZone } from '../utils/regionFromTimeZone'

// Static, hand-maintained crisis support resources, keyed by jurisdiction,
// with an always-available international fallback.
//
// This data is DELIBERATELY hardcoded and must stay that way. It is never
// AI-generated and never fetched at runtime: a helpline number that is wrong,
// out of date, or quietly changed by a third-party API is worse than no number
// at all, because someone in distress may rely on it. Every change here is a
// hand review against the service's own published contact details.
//
// Scope note: this is signposting to real, external services only. It is not a
// crisis service, not clinical advice, and not a substitute for emergency
// services. Rectifia cannot see who views this and cannot contact any of these
// services on a reporter's behalf.
//
// Each entry: { name, contact, hours, jurisdiction, notes }
//   jurisdiction: one of 'EU' | 'UK' | 'US' | 'AU' | 'JP' | 'LK', or 'INTL'
//   for the fallback. LK is deprecated for new company selection
//   (companyService.js SELECTABLE_JURISDICTIONS) but its entries stay here
//   for companies still configured with it.
//
// If you are updating a number, verify it against the service's own website
// first. When in doubt, prefer removing an entry over shipping one you cannot
// confirm.

// Always shown, alongside any jurisdiction-matched entries and never on its
// own being enough of a reason to hide them. A reporter may be anywhere in the
// world, not in the company's country, so an international route to local help
// is always offered.
export const INTERNATIONAL_RESOURCES = [
  {
    name: 'Find A Helpline',
    contact: 'findahelpline.com',
    hours: 'Directory - available any time',
    jurisdiction: 'INTL',
    notes:
      'A free directory of verified support lines in over 130 countries. Choose your country to find a local service you can call, text, or chat with.',
  },
  {
    name: 'Befrienders Worldwide',
    contact: 'befrienders.org',
    hours: 'Directory - available any time',
    jurisdiction: 'INTL',
    notes:
      'A worldwide network of emotional-support centres. The site lists local centres by country.',
  },
]

// Jurisdiction-matched resources. Keyed by the codes used in
// companies.jurisdictions ('EU' | 'UK' | 'US' | 'AU' | 'JP' | 'LK').
export const CRISIS_RESOURCES = {
  UK: [
    {
      name: 'Samaritans',
      contact: 'Call 116 123',
      hours: 'Every day, 24 hours',
      jurisdiction: 'UK',
      notes: 'Free to call from any phone. You do not have to be suicidal to call.',
    },
    {
      name: 'Shout',
      contact: 'Text SHOUT to 85258',
      hours: 'Every day, 24 hours',
      jurisdiction: 'UK',
      notes: 'A free, text-based service if you would rather not speak on the phone.',
    },
    {
      name: 'Emergency services',
      contact: 'Call 999',
      hours: 'Every day, 24 hours',
      jurisdiction: 'UK',
      notes: 'For an immediate emergency where someone is in danger right now.',
    },
  ],
  US: [
    {
      name: '988 Suicide & Crisis Lifeline',
      contact: 'Call or text 988',
      hours: 'Every day, 24 hours',
      jurisdiction: 'US',
      notes: 'Free and confidential support. You can also chat online at 988lifeline.org.',
    },
    {
      name: 'Emergency services',
      contact: 'Call 911',
      hours: 'Every day, 24 hours',
      jurisdiction: 'US',
      notes: 'For an immediate emergency where someone is in danger right now.',
    },
  ],
  EU: [
    {
      name: 'European emotional support line',
      contact: 'Call 116 123',
      hours: 'Hours vary by country',
      jurisdiction: 'EU',
      notes:
        'A free emotional-support number available in many European countries. If it does not connect where you are, Find A Helpline below lists a local service.',
    },
    {
      name: 'Emergency services',
      contact: 'Call 112',
      hours: 'Every day, 24 hours',
      jurisdiction: 'EU',
      notes:
        'The single emergency number across the EU, for when someone is in danger right now.',
    },
  ],
  AU: [
    {
      name: 'Lifeline Australia',
      contact: 'Call 13 11 14',
      hours: 'Every day, 24 hours',
      jurisdiction: 'AU',
      notes: 'Free and confidential crisis support. You can also text 0477 13 11 14 or chat online at lifeline.org.au.',
    },
    {
      name: 'Beyond Blue',
      contact: 'Call 1300 22 4636',
      hours: 'Every day, 24 hours',
      jurisdiction: 'AU',
      notes: 'Free and confidential support for anxiety, depression, and general mental health. Webchat also available at beyondblue.org.au.',
    },
    {
      name: '13YARN',
      contact: 'Call 13 92 76',
      hours: 'Every day, 24 hours',
      jurisdiction: 'AU',
      notes: 'A crisis support line run by Aboriginal and Torres Strait Islander Crisis Supporters, for Aboriginal and Torres Strait Islander people.',
    },
  ],
  JP: [
    {
      name: 'Yorisoi Hotline (よりそいホットライン)',
      contact: 'Call 0120-279-338',
      hours: 'Every day, 24 hours (free to call)',
      jurisdiction: 'JP',
      notes: 'A free, toll-free consultation line covering a wide range of concerns including suicidal thoughts. Press 2 after the Japanese guidance for foreign-language support.',
    },
    {
      name: 'TELL Lifeline',
      contact: 'Call 03-5774-0992 (or toll-free 0800-300-8355)',
      hours: 'Hours vary - check telljp.com/tell-hours for current hours',
      jurisdiction: 'JP',
      notes: 'English-language confidential support for the international community in Japan. Online chat also available on some days - check telljp.com.',
    },
  ],
  LK: [
    {
      name: 'Sri Lanka Sumithrayo',
      contact: 'Call +94 11 2 692 535',
      hours: 'Hours vary - check sumithrayo.lk',
      jurisdiction: 'LK',
      notes: 'Confidential emotional support. Also reachable at +94 11 2 682 535.',
    },
    {
      name: 'National Mental Health Helpline',
      contact: 'Call 1926',
      hours: 'Every day, 24 hours',
      jurisdiction: 'LK',
      notes: 'A free national helpline for mental health support.',
    },
    {
      name: 'Emergency services',
      contact: 'Call 1990 (Suwa Seriya ambulance)',
      hours: 'Every day, 24 hours',
      jurisdiction: 'LK',
      notes: 'For an immediate emergency where someone is in danger right now.',
    },
  ],
}

// Display labels for the "other countries" grouping only - not used for
// matching or storage, just so the four regional "Emergency services"
// entries read as attributed to different countries instead of looking like
// duplicates of each other.
const REGION_LABELS = {
  UK: 'United Kingdom',
  US: 'United States',
  EU: 'Europe',
  AU: 'Australia',
  JP: 'Japan',
  LK: 'Sri Lanka',
}

function groupByRegion(codes) {
  return codes
    .map((code) => ({ jurisdiction: code, label: REGION_LABELS[code] ?? code, entries: CRISIS_RESOURCES[code] ?? [] }))
    .filter((group) => group.entries.length > 0)
}

function dedupe(codes) {
  const seen = new Set()
  const result = []
  for (const code of codes) {
    if (seen.has(code)) continue
    seen.add(code)
    result.push(code)
  }
  return result
}

// Resolves a set of jurisdiction codes to the resources to show, split into
// `primary` (shown expanded) and `other` (every remaining region, grouped by
// jurisdiction for a collapsed "other countries" expander). The international
// fallback is ALWAYS included in `primary`, alongside any jurisdiction-
// specific entries rather than instead of them. Unknown codes are ignored.
//
// An explicit `jurisdictions` argument always takes precedence. Absent one,
// the browser's own time zone (see utils/regionFromTimeZone.js - nothing
// transmitted, nothing stored) supplies a single best-guess region for
// `primary`; every other region still remains reachable in `other`. If
// neither resolves anything (unset jurisdictions and an unrecognised or
// unavailable time zone), `primary` is the international fallback alone and
// `other` lists every region - a reporter anywhere can still find local help.
export function resolveResources(jurisdictions) {
  const allCodes = Object.keys(CRISIS_RESOURCES)

  if (Array.isArray(jurisdictions) && jurisdictions.length > 0) {
    const codes = dedupe(jurisdictions)
    const regional = codes.flatMap((code) => CRISIS_RESOURCES[code] ?? [])
    const remaining = allCodes.filter((code) => !codes.includes(code))
    return {
      primary: [...regional, ...INTERNATIONAL_RESOURCES],
      other: groupByRegion(remaining),
    }
  }

  const region = regionFromTimeZone()
  if (region && CRISIS_RESOURCES[region]) {
    const remaining = allCodes.filter((code) => code !== region)
    return {
      primary: [...CRISIS_RESOURCES[region], ...INTERNATIONAL_RESOURCES],
      other: groupByRegion(remaining),
    }
  }

  return {
    primary: [...INTERNATIONAL_RESOURCES],
    other: groupByRegion(allCodes),
  }
}
