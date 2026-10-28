/**
 * Address words and matching for the county suggestions: how people type an
 * address against how Marion County writes it.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { addressWords, matches, cityText, addressParts, addressCount, directionOf, directionsFit, suggestCensusAll, streetEstimate } from '../src/server/lib/addressIndex'

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

describe('city, state and ZIP from a one line address', () => {
  test('the forms people type', () => {
    expect(addressParts('99999 Nowhere Ln, Ocala, FL 34471')).toEqual({ city: 'Ocala', state: 'FL', zip: '34471' })
    expect(addressParts('99999 Nowhere Ln, Ocala FL 34471')).toEqual({ city: 'Ocala', state: 'FL', zip: '34471' })
    expect(addressParts('99999 Nowhere Ln, citrus springs, Florida')).toEqual({ city: 'Citrus Springs', state: 'FL', zip: '' })
    expect(addressParts('99999 Nowhere Ln, Ocala, FL, 34476')).toEqual({ city: 'Ocala', state: 'FL', zip: '34476' })
    expect(addressParts('99999 Nowhere Ln, Ocala, FL 34471-1234')).toEqual({ city: 'Ocala', state: 'FL', zip: '34471' })
  })
  test('a part that cannot be read is left empty', () => {
    expect(addressParts('99999 Nowhere Circle Ocala, FL 34473')).toEqual({ city: '', state: 'FL', zip: '34473' })
    expect(addressParts('99999 Nowhere Ln')).toEqual({ city: '', state: '', zip: '' })
    expect(addressParts('99999 Nowhere Ln, Ocala, Marion')).toEqual({ city: '', state: '', zip: '' })
    expect(addressParts('')).toEqual({ city: '', state: '', zip: '' })
  })
})

describe.skipIf(addressCount() === 0)('city, state and ZIP from the county list', () => {
  test('a typed address the county knows takes the county city and ZIP', () => {
    expect(addressParts('1301 SE Silver Springs Pl, Ocala, FL 34471')).toEqual({ city: 'Ocala', state: 'FL', zip: '34471' })
    expect(addressParts('17008 Southeast 60th Street, Ocklawaha')).toEqual({ city: 'Ocklawaha', state: 'FL', zip: '32179' })
  })
})

describe('directions: SE, SW, NE, NW and spelled out (review Oct 28 2026: "2200 SE Fort King St" offered W and E only)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  test('a direction typed part way, spelled out', () => {
    expect(m('17008 Southe', '17008 SE 60TH ST')).toBe(true)
    expect(m('17008 Southw', '17008 SE 60TH ST')).toBe(false)
    expect(m('9161 Northe', '9161 NE 310TH AVE')).toBe(true)
    expect(m('9161 Nor', '9161 NE 310TH AVE')).toBe(true)
    expect(m('9161 Northwest 310', '9161 NE 310TH AVE')).toBe(false)
    expect(m('2061 Southwest Fort', '2061 SW FORT KING ST')).toBe(true)
  })
  test('which directions are the same side of town', () => {
    expect(directionOf(addressWords('2200 SE Fort King St'))).toBe('SE')
    expect(directionOf(addressWords('2200 Southeast Fort King St'))).toBe('SE')
    expect(directionOf(addressWords('27 Cedar Trace'))).toBe('')
    expect([directionsFit('SE', 'E'), directionsFit('SE', 'S'), directionsFit('E', 'SE'), directionsFit('SE', 'SE'), directionsFit('', 'W')]).toEqual([true, true, true, true, true])
    expect([directionsFit('SE', 'W'), directionsFit('SE', 'SW'), directionsFit('NE', 'N'), directionsFit('NW', 'E')]).toEqual([false, false, true, false])
  })
  test('the Census answer: W is never offered for SE; SE first, then E (no outside call: the answer is made here)', async () => {
    const at = (a: string, x: number) => ({ matchedAddress: a, coordinates: { x, y: 29.18 } })
    vi.stubGlobal('fetch', async () => ({ json: async () => ({ result: { addressMatches: [at('2200 W FORT KING ST, OCALA, FL, 34471', -82.16), at('2200 E FORT KING ST, OCALA, FL, 34471', -82.11), at('2200 SE FORT KING ST, OCALA, FL, 34471', -82.10)] } }) }))
    const got = (await suggestCensusAll('2200 SE Fort King St')).map(s => s.line1)
    expect(got).toEqual(['2200 SE Fort King St', '2200 E Fort King St'])
    const spelled = (await suggestCensusAll('2200 Southeast Fort King St')).map(s => s.line1)
    expect(spelled).not.toContain('2200 W Fort King St')
    // No direction typed: every match in the work area, as before.
    expect((await suggestCensusAll('2200 Fort King St')).map(s => s.line1)).toHaveLength(3)
  })
})

describe.skipIf(addressCount() === 0)('a street the county writes with one letter', () => {
  test('"2200 SE Fort King St": placed on the county\'s E Fort King St, SE kept', () => {
    const s = streetEstimate('2200 SE Fort King St')
    expect(s).toMatchObject({ line1: '2200 SE Fort King St', city: 'Ocala', zip: '34471', source: 'street' })
    expect(streetEstimate('2200 NW Fort King St')).toBeNull()
  })
})
