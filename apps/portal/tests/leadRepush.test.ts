/**
 * When a lead still not assigned is pushed again (lib/leadRepush.ts; Jonathan,
 * Oct 29 2026, D8): 2 hours after it came in, and 8 am Florida time the next
 * day. No more. Pure: no database.
 */

import { describe, test, expect } from 'vitest'
import { repushPlan, repushTimes, repushWords, type RepushSlot } from '../src/server/lib/leadRepush.js'

const none = new Set<RepushSlot>()
const at = (iso: string) => new Date(iso)

describe('lead repeat push times', () => {
  test('3:10 pm lead: 5:10 pm the same day, then 8:00 am the next day (Florida time)', () => {
    const t = repushTimes(at('2026-10-29T19:10:00Z')) // 3:10 pm EDT
    expect(t.twoHours.toISOString()).toBe('2026-10-29T21:10:00.000Z')
    expect(t.nextMorning.toISOString()).toBe('2026-10-30T12:00:00.000Z') // 8:00 am EDT
    expect(t.morningUntil.toISOString()).toBe('2026-10-30T16:00:00.000Z') // noon EDT
  })

  test('11 pm lead: the 2 hour push lands at 1 am; 8 am is the morning after the Florida day it came in', () => {
    const t = repushTimes(at('2026-10-30T03:00:00Z')) // 11:00 pm EDT Oct 29
    expect(t.twoHours.toISOString()).toBe('2026-10-30T05:00:00.000Z') // 1:00 am EDT
    expect(t.nextMorning.toISOString()).toBe('2026-10-30T12:00:00.000Z') // 8:00 am Oct 30
  })

  test('across the clock change: 8 am Eastern standard time', () => {
    const t = repushTimes(at('2026-10-31T19:00:00Z')) // 3 pm EDT Sat Oct 31; Nov 1 is EST
    expect(t.nextMorning.toISOString()).toBe('2026-11-01T13:00:00.000Z')
  })

  test('nothing before 2 hours; the 2 hour push once due; then nothing until 8 am', () => {
    const came = at('2026-10-29T19:10:00Z')
    expect(repushPlan(came, at('2026-10-29T21:09:59Z'), none)).toEqual({ send: null, skip: [] })
    expect(repushPlan(came, at('2026-10-29T21:10:00Z'), none)).toEqual({ send: '2h', skip: [] })
    expect(repushPlan(came, at('2026-10-30T02:00:00Z'), new Set(['2h'] as const))).toEqual({ send: null, skip: [] })
    expect(repushPlan(came, at('2026-10-30T12:00:00Z'), new Set(['2h'] as const))).toEqual({ send: '8am', skip: [] })
  })

  test('both written down: never a third', () => {
    const came = at('2026-10-29T19:10:00Z')
    const both = new Set(['2h', '8am'] as const)
    for (const now of ['2026-10-30T12:00:00Z', '2026-10-30T15:59:00Z', '2026-10-31T12:00:00Z', '2026-11-05T12:00:00Z']) {
      expect(repushPlan(came, at(now), both)).toEqual({ send: null, skip: [] })
    }
  })

  test('the server was down through 8 am: only the 8 am push, the 2 hour one skipped (one push, not two)', () => {
    const came = at('2026-10-29T19:10:00Z')
    expect(repushPlan(came, at('2026-10-30T13:30:00Z'), none)).toEqual({ send: '8am', skip: ['2h'] })
  })

  test('the server was down until after noon: the 8 am push is skipped too', () => {
    const came = at('2026-10-29T19:10:00Z')
    expect(repushPlan(came, at('2026-10-30T16:00:00Z'), none)).toEqual({ send: null, skip: ['2h', '8am'] })
    expect(repushPlan(came, at('2026-10-30T16:00:00Z'), new Set(['2h'] as const))).toEqual({ send: null, skip: ['8am'] })
  })

  test('what the repeat push says', () => {
    const lead = { name: 'Dana Lee', sourceWords: 'Website quote', town: 'Ocala', what: "Vinyl, Privacy, 6', White" }
    expect(repushWords(lead, at('2026-10-29T19:10:00Z'), at('2026-10-29T21:10:00Z'))).toEqual({
      title: 'Still not assigned: Dana Lee', body: "Website quote · Ocala · Vinyl, Privacy, 6', White. Came in at 3:10 PM. Tap to assign.",
    })
    expect(repushWords({ ...lead, town: '', what: 'Call back tomorrow 3 pm', sourceWords: 'Phone call' }, at('2026-10-29T19:10:00Z'), at('2026-10-30T12:00:00Z')).body)
      .toBe('Phone call · Call back tomorrow 3 pm. Came in yesterday at 3:10 PM. Tap to assign.')
  })
})
