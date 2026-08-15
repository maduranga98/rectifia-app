import { describe, it, expect } from 'vitest'
import { textIndicatesCrisis } from '../crisisTextCheck'

const PHRASES = [
  'kill myself',
  'end my life',
  'take my own life',
  'want to die',
  "don't want to live",
  'dont want to live',
  'no reason to live',
  'better off dead',
  'suicidal',
  'suicide',
  'hurt myself',
  'harm myself',
]

describe('textIndicatesCrisis', () => {
  it.each(PHRASES)('trips on the phrase "%s"', (phrase) => {
    expect(textIndicatesCrisis(`I keep thinking that I ${phrase} lately`)).toBe(true)
  })

  it.each(PHRASES)('trips on "%s" regardless of case', (phrase) => {
    expect(textIndicatesCrisis(phrase.toUpperCase())).toBe(true)
  })

  it('trips on a curly right single quotation mark (U+2019)', () => {
    expect(textIndicatesCrisis('I don’t want to live any more.')).toBe(true)
  })

  it('trips on a modifier letter apostrophe (U+02BC)', () => {
    expect(textIndicatesCrisis('I donʼt want to live any more.')).toBe(true)
  })

  it('does not trip on "this job is killing me"', () => {
    expect(textIndicatesCrisis('this job is killing me')).toBe(false)
  })

  it('does not trip on "I am completely exhausted"', () => {
    expect(textIndicatesCrisis('I am completely exhausted')).toBe(false)
  })

  it('returns false for empty or non-string input', () => {
    expect(textIndicatesCrisis('')).toBe(false)
    expect(textIndicatesCrisis(null)).toBe(false)
    expect(textIndicatesCrisis(undefined)).toBe(false)
  })
})
