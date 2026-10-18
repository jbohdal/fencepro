/**
 * Address words and matching for the county suggestions: how people type an
 * address against how Marion County writes it.
 */
import { describe, test, expect } from 'vitest'
import { addressWords, matches, cityText } from '../src/server/lib/addressIndex'

const m = (typed: string, county: string) => matches(addressWords(typed), addressWords(county))

describe('address words', () => {
  test('long words, ordinals and highways in the county form', () => {
    expect(addressWords('17008 Southeast 60th St.')).toEqual(['17008', 'SE', '60', 'ST'])
    expect(addressWords('15912 FL-40')).toEqual(['15912', 'HWY', '40'])
    expect(addressWords('27 Cedar Trace')).toEqual(['27', 'CEDAR', 'TRCE'])
    expect(addressWords('13080 SE 122nd PI')).toEqual(['13080', 'SE', '122', 'PL'])
  })
  test('cities as people write them', () => {
    expect(cityText('FT MCCOY')).toBe('Fort McCoy')
    expect(cityText('FORT MC COY')).toBe('Fort McCoy')
    expect(cityText('SILVER SPRINGS')).toBe('Silver Springs')
  })
})

describe('typing matches the county street', () => {
  test('house number and the start of the street', () => {
    expect(m('17008 SE 60', '17008 SE 60TH ST')).toBe(true)
    expect(m('9161 Northeast 310', '9161 NE 310TH AVE')).toBe(true)
    expect(m('27 Cedar Trace', '27 CEDAR TRCE')).toBe(true)
    expect(m('220 SE 165th ct rd', '220 SE 165TH COURT RD')).toBe(true)
    expect(m('220 SE 165', '220 SE 165TH COURT RD')).toBe(true)
  })
  test('a direction the county adds may be left out', () => {
    expect(m('15912 FL-40', '15912 E HWY 40')).toBe(true)
    expect(m('6701 Anthony', '6701 W ANTHONY RD')).toBe(true)
  })
  test('a different house number or street does not match', () => {
    expect(m('17009 SE 60', '17008 SE 60TH ST')).toBe(false)
    expect(m('17008 SE 61', '17008 SE 60TH ST')).toBe(false)
    expect(m('17008 NE 60', '17008 SE 60TH ST')).toBe(false)
  })
})
