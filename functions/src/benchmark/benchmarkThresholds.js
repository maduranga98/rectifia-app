// Module 25 - Cross-Company Benchmark Pool.
//
// The pool exists so a company with no history of its own can still see whether
// its handling of a case is typical, and so a company with a long history can
// still ask whether the shape of its own case volume is normal for its sector.
// It is aggregate statistics, never raw case data.
//
// The two thresholds below are the whole reason the pool can be honestly sold
// as anonymous. A cell must clear BOTH of them before any statistic is
// published:
//
//   MIN_COMPANIES_PER_CELL = 5
//   MIN_CASES_PER_CELL     = 25
//
// Five companies is not enough if four of them contributed one case each -
// twenty-one cases from one company and one apiece from four others would
// clear the "five companies" bar and still let a reader with any inside
// knowledge attribute the shape of the cell to the one company that dominates
// it. Twenty-five cases is not enough either, if they all came from two
// companies. Requiring both closes the obvious attack, which is a competitor
// opting in specifically to read a thin cell.
//
// Neither threshold is configurable at runtime by any role, for the same
// reason MIN_RESPONSES_FOR_AGGREGATE in functions/src/intake/analyzePulseResponse.js
// is hardcoded: the number is a privacy guarantee, and a runtime toggle would
// convert it into a business preference a future admin would inevitably tune
// down "so the feature looks better populated". If a threshold ever needs to
// change, it changes here in code, in a reviewed deploy, not in a settings
// screen.
const MIN_COMPANIES_PER_CELL = 5
const MIN_CASES_PER_CELL = 25

// The industries a company may declare, and the four employee-count bands a
// company falls into. Deliberately coarse: every additional dimension shrinks
// cell populations and moves re-identification closer, so this pool never
// admits department, job level, or geography below country - all of which
// were considered and rejected on that basis. Adding an industry is fine;
// adding a dimension is a design change.
const INDUSTRIES = [
  'technology',
  'finance',
  'healthcare',
  'manufacturing',
  'retail',
  'education',
  'hospitality',
  'construction',
  'transportation',
  'professional_services',
  'nonprofit',
  'government',
  'media',
  'energy',
  'other',
]

// (label, floor, ceiling) - inclusive on both sides. Ceilings are open on the
// last band. The bands are the same shape most public HR statistics use, which
// is what lets an operator sanity-check a cell against an external benchmark
// without playing definitional games.
const SIZE_BANDS = [
  { id: '1-50', label: '1 to 50', min: 1, max: 50 },
  { id: '51-200', label: '51 to 200', min: 51, max: 200 },
  { id: '201-1000', label: '201 to 1,000', min: 201, max: 1000 },
  { id: '1001-5000', label: '1,001 to 5,000', min: 1001, max: 5000 },
]

// The four case categories are the same set functions/src/intake/submitCase.js
// enforces on the write side. Kept as a list here rather than imported to
// avoid a dependency on the intake module - a benchmark pool has no business
// reaching into the code path that writes cases.
const CATEGORIES = ['harassment', 'toxicManagement', 'retaliation', 'burnout']

function isKnownIndustry(industry) {
  return typeof industry === 'string' && INDUSTRIES.includes(industry)
}

// Maps a raw employee count to one of the band ids above, or null when the
// company falls outside every band (unset, zero, or larger than the largest
// band). Nothing is published for a company that doesn't fit a band; a
// company larger than the top band is coarser evidence than the pool is set
// up to describe honestly, so it doesn't contribute and doesn't read.
function bandForEmployeeCount(employeeCount) {
  const n = Number(employeeCount)
  if (!Number.isFinite(n) || n < 1) return null
  for (const band of SIZE_BANDS) {
    if (n >= band.min && n <= band.max) return band.id
  }
  return null
}

function isKnownCategory(category) {
  return typeof category === 'string' && CATEGORIES.includes(category)
}

// The cell id is the tuple that identifies a cell across recomputations, and
// it is a stable string so a benchmarkCells doc can be overwritten in place on
// each monthly run. No hashing - this id is not a secret; it is the same
// (industry, band, category) the reader is asking for by name.
function cellId(industry, sizeBand, category) {
  return `${industry}__${sizeBand}__${category}`
}

module.exports = {
  MIN_COMPANIES_PER_CELL,
  MIN_CASES_PER_CELL,
  INDUSTRIES,
  SIZE_BANDS,
  CATEGORIES,
  isKnownIndustry,
  isKnownCategory,
  bandForEmployeeCount,
  cellId,
}
