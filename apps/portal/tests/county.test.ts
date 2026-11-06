/**
 * Which county a job is in (lib/county.ts), from the Census geocoder's answer
 * (recorded shape, Nov 6 2026): a Leesburg spot is Lake, not Marion; the
 * Marion address list answers Marion without asking; an answer is kept; a
 * failure is not, and falls back to the address, then the permit's county.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { countyAt, jobCounty, forgetCounties } from '../src/server/lib/county'

const answer = (basename: string, state = '12') => ({ result: { geographies: { Counties: [{ GEOID: `${state}069`, STATE: state, BASENAME: basename, NAME: `${basename} County` }] } } })
const census = (by: (url: string) => any) => {
  const asked: string[] = []
  const fn = async (url: string) => { asked.push(url); const j = by(url); return j === 'fail' ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => j } }
  return { fn, asked }
}

beforeEach(() => forgetCounties())

describe('the county of a job', () => {
  test('Leesburg is Lake County, asked once for the spot', async () => {
    const c = census(() => answer('Lake'))
    expect(await countyAt(28.8108, -81.8779, c.fn)).toBe('Lake')
    expect(await countyAt(28.81081, -81.87791, c.fn)).toBe('Lake')
    expect(c.asked.length).toBe(1)
    expect(c.asked[0]).toMatch(/geocoding\.geo\.census\.gov\/geocoder\/geographies\/coordinates\?x=-81\.87790&y=28\.81080/)
  })

  test('outside Florida, or no answer: not told', async () => {
    expect(await countyAt(33.7, -84.4, census(() => answer('Fulton', '13')).fn)).toBeNull()
    expect(await countyAt(28.9, -81.9, census(() => 'fail').fn)).toBeNull()
  })

  test('a job: its spot first, then its address, then the permit\'s county', async () => {
    const byMap = census(u => (u.includes('/coordinates') ? answer('Sumter') : answer('Lake')))
    expect(await jobCounty({ customerAddress: '1 Main St, Wildwood, FL 34785', lat: 28.86, lng: -82.04 }, null, 'Marion', byMap.fn)).toBe('Sumter')
    const byAddress = census(u => (u.includes('/onelineaddress') ? { result: { addressMatches: [answer('Lake').result] } } : 'fail'))
    expect(await jobCounty({ customerAddress: '2 Main St, Leesburg, FL 34748' }, null, 'Marion', byAddress.fn)).toBe('Lake')
    expect(await jobCounty({ customerAddress: '3 Nowhere Rd' }, null, 'Citrus', census(() => 'fail').fn)).toBe('Citrus')
  })
})
