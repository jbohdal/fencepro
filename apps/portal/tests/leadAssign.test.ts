/**
 * What the owner's push about a new lead says (lib/leadAssign.ts): who, where
 * from, the town and what they asked for, in a few words.
 */

import { describe, test, expect } from 'vitest'
import { townOf, leadPushWords, canAssignLeads } from '../src/server/lib/leadAssign.js'

describe('the town of an address', () => {
  test.each([
    ['12 Elm St, Ocala, FL 34470', 'Ocala'],
    ['12 Elm St, Ocala FL 34470', 'Ocala'],
    ['4400 SE 3rd Ave, Belleview, Florida, USA', 'Belleview'],
    ['12 Elm St, Dunnellon, FL', 'Dunnellon'],
    ['Ocala, FL', 'Ocala'],
    ['12 Elm St', ''],
    ['', ''],
    [null, ''],
  ])('%s -> %s', (address, town) => {
    expect(townOf(address as string | null)).toBe(town)
  })
})

describe('the push words', () => {
  test('a website quote: name, where from, town, the fence and its feet', () => {
    expect(leadPushWords({ name: 'Dana Fields', source: 'ez_quote', address: '12 Elm St, Ocala, FL 34470', fenceType: "Vinyl, Privacy, 6', White", feet: 152 }))
      .toEqual({ title: 'New lead: Dana Fields', body: "Website quote · Ocala · Vinyl, Privacy, 6', White, 152 ft. Tap to assign." })
  })
  test('a phone call with no fence named says the call back', () => {
    expect(leadPushWords({ name: 'Ray Cole', source: 'retell', address: '9 Oak Rd, Belleview, FL 34420', callbackAt: 'tomorrow 3 pm' }).body)
      .toBe('Phone call · Belleview · call back tomorrow 3 pm. Tap to assign.')
  })
  test('a website chat booking says the visit; no address leaves the town out', () => {
    expect(leadPushWords({ name: 'Lee', source: 'website_chat', asked: 'estimate Thursday, October 29, 10:00 AM' }).body)
      .toBe('Website chat · estimate Thursday, October 29, 10:00 AM. Tap to assign.')
  })
  test('no name: Someone', () => {
    expect(leadPushWords({ name: '  ', source: 'ez_quote' }).title).toBe('New lead: Someone')
  })
})

test('only the owner, admin, manager and office assign', () => {
  expect(['super_admin', 'admin', 'manager', 'office_staff'].every(canAssignLeads)).toBe(true)
  expect(['sales_rep', 'field_crew', 'customer', '', null].some(r => canAssignLeads(r as string | null))).toBe(false)
})
