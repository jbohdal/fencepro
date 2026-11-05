/**
 * A customer's properties (lib/properties.ts; Jonathan, Nov 5 2026): "is this
 * the same property" reads the street the same however it is written, and the
 * web's copy (apps/web/src/propertyAddress.ts, used for search and the
 * duplicate checks on the phone) reads it exactly as the server does.
 */

import { describe, test, expect } from 'vitest'
import { addressKey as serverKey, sameAddress } from '../src/server/lib/properties'
import { addressKey as webKey, hasPropertyAt } from '../../web/src/propertyAddress'

const SAME: Array<[string, string]> = [
  ['10438 SW 75th Terrace Ocala, FL 34476', '10438 SW 75th Terrace, Ocala, FL 34476'],
  ['10116 Southwest 78th Court, Ocala FL', '10116 SW 78 Ct'],
  ['8447 SW 58 Lp Ocala, FL 34481', '8447 SW 58th Loop'],
  ['12345 E Hwy 40 Silver Springs FL', '12345 E HWY 40, Silver Springs'],
  ['570 Silver Course Radl Ocala, FL 34472', '570 Silver Course Radial, Ocala, FL 34472'],
  ['185 Fisher Course Ocklawaha, FL 32179', '185 Fisher Crse, Ocklawaha, FL 32179'],
  ['12889 SW 81st St Dunnellon, FL 34432', '12889 SW 81st Str, Dunnellon, FL 34432'],
  ['2679 Windsor Lks Wy Green Cove Springs, FL 32043', '2679 Windsor Lks Way, Green Cove Springs, FL 32043'],
  ['833 Marion Oaks Manor Ocala, FL 34473', '833 Marion Oaks Manor, Ocala, FL 34473'],
]
const DIFFERENT: Array<[string, string]> = [
  ['7745 SW 86th Lane Ocala, FL 34476', '10472 SW 67th Ct, Ocala, FL 34476'],
  ['2586 SW 146th St Ocala, FL 34473', '2566 SW 146th St, Ocala, FL 34473'],
  ['3278 NE 38th Ln Ocala, FL 34479', '3278 NE 35th ln, Ocala, FL 34479'],
  ['TBD ocala, FL 34470', 'TBD, ocala, FL 34470'],
  ['', ''],
]

describe('the same property', () => {
  test('one street written two ways is one property; another house or street is not; no house number never matches', () => {
    for (const [a, b] of SAME) expect(sameAddress(a, b), `${a} | ${b}`).toBe(true)
    for (const [a, b] of DIFFERENT) expect(sameAddress(a, b), `${a} | ${b}`).toBe(false)
  })

  test('the phone reads every address as the server does', () => {
    for (const a of [...SAME.flat(), ...DIFFERENT.flat(), '5 Main St Apt 2 Ocala', 'PO BOX 1606, Valdosta, GA 31603', '14854 SW 65th rd ave, Ocala, FL 34473', '22nd Court 4221 NE, Ocala, FL 34479']) {
      expect(webKey(a), a).toBe(serverKey(a))
    }
  })

  test('a customer is found by any property of theirs, Primary or not', () => {
    const c = { serviceAddress: '10438 SW 75th Terrace, Ocala, FL 34476', propertyAddresses: ['10438 SW 75th Terrace, Ocala, FL 34476', '8447 SW 58th Loop, Ocala, FL 34481'] }
    expect(hasPropertyAt(c, '8447 SW 58 Lp Ocala')).toBe(true)
    expect(hasPropertyAt(c, '10438 SW 75 Ter')).toBe(true)
    expect(hasPropertyAt(c, '8449 SW 58th Loop')).toBe(false)
    expect(hasPropertyAt(c, '')).toBe(false)
  })
})
