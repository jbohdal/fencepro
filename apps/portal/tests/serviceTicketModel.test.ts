/**
 * Warranty and service requests: the shared rules (lib/serviceTicketModel.ts).
 * The hints per kind of warranty, the photo link's limits and text, the past
 * customer badge's words, and the report's math.
 */

import { describe, test, expect } from 'vitest'
import {
  HINT_RULES, ISSUES, hintFor, hintsFor, warrantyKindOf, uploadRefusal, photoRequestText, badgeText, serviceReport, stageForCustomer,
  PHOTO_MAX_BYTES, VIDEO_MAX_BYTES, MAX_CUSTOMER_FILES, type ReportTicket,
} from '../src/server/lib/serviceTicketModel.js'

describe('the hints from the warranty', () => {
  test('Lifetime no dig: a leaning post is likely covered (install failure, high winds included); the rest need a look', () => {
    expect(hintFor('lifetime', 'leaning_post').hint).toBe('likely_covered')
    expect(hintFor('lifetime', 'leaning_post').why).toContain('high winds')
    for (const i of ['damaged_section', 'gate', 'storm_tree', 'other']) expect(hintFor('lifetime', i).hint).toBe('needs_look')
    expect(hintFor('lifetime', 'storm_tree').why).toMatch(/falling trees.*not/i)
  })
  test('1 Year Workmanship inside its year: storm or tree damage is likely not covered (severe weather and impact)', () => {
    expect(hintFor('workmanship', 'storm_tree').hint).toBe('likely_not_covered')
    expect(hintFor('workmanship', 'leaning_post').hint).toBe('likely_covered')
  })
  test('an ended warranty: every issue likely not covered, with the day it ended', () => {
    for (const i of ISSUES) expect(hintFor('ended', i.key, 'May 1, 2024')).toEqual({ hint: 'likely_not_covered', why: 'The warranty ended May 1, 2024.' })
  })
  test('no warranty on file: needs a look; an unknown issue reads as Other', () => {
    expect(Object.values(hintsFor('none')).every(h => h.hint === 'needs_look')).toBe(true)
    expect(hintFor('lifetime', 'made-up')).toEqual(HINT_RULES.lifetime.other)
  })
  test('the kind of warranty from its term, install date and end', () => {
    expect(warrantyKindOf({ term: 'lifetime', installDate: '2020-01-01', end: null }, '2026-10-22')).toBe('lifetime')
    expect(warrantyKindOf({ term: 'lifetime', installDate: null, end: null }, '2026-10-22')).toBe('none')
    expect(warrantyKindOf({ term: 'years', installDate: '2026-01-01', end: '2027-01-01' }, '2026-10-22')).toBe('workmanship')
    expect(warrantyKindOf({ term: 'years', installDate: '2026-01-01', end: '2027-01-01' }, '2027-01-01')).toBe('workmanship')
    expect(warrantyKindOf({ term: 'years', installDate: '2025-01-01', end: '2026-01-01' }, '2026-10-22')).toBe('ended')
    expect(warrantyKindOf({ term: 'unknown', installDate: '2025-01-01', end: null }, '2026-10-22')).toBe('none')
  })
})

describe('the photo link', () => {
  test('photos and short videos only, within their sizes, 30 a request', () => {
    expect(uploadRefusal('image/jpeg', 1000, 0)).toBeNull()
    expect(uploadRefusal('image/heic', PHOTO_MAX_BYTES, 0)).toBeNull()
    expect(uploadRefusal('image/png', PHOTO_MAX_BYTES + 1, 0)).toContain('25 MB')
    expect(uploadRefusal('video/quicktime', VIDEO_MAX_BYTES, 0)).toBeNull()
    expect(uploadRefusal('video/mp4', VIDEO_MAX_BYTES + 1, 0)).toContain('300 MB')
    expect(uploadRefusal('application/pdf', 10, 0)).toBe('Please send a photo or a video.')
    expect(uploadRefusal('image/gif', 10, 0)).toBe('Please send a photo or a video.')
    expect(uploadRefusal('image/jpeg', 10, MAX_CUSTOMER_FILES - 1)).toBeNull()
    expect(uploadRefusal('image/jpeg', 10, MAX_CUSTOMER_FILES)).toContain('all the photos we can take')
  })
  test('the text, word for word', () => {
    expect(photoRequestText('Pat', 'https://door/p/s/abc')).toBe('Getter Done Fence: Hi Pat, sorry to hear about the issue with your fence. Please send us a few photos here so we can take a look: https://door/p/s/abc. Reply STOP to opt out.')
    expect(photoRequestText(' ', 'L')).toContain('Hi there,')
  })
  test('the customer\'s words for each stage', () => {
    expect(stageForCustomer('photos_requested')).toBe('Waiting for your photos')
    expect(stageForCustomer('scheduled')).toBe('Visit scheduled')
  })
})

describe('the past customer badge', () => {
  test('warranty and install date', () => {
    expect(badgeText({ warrantyName: 'Lifetime Craftsmanship Warranty', installDate: '2026-10-20' })).toBe('Past customer · Lifetime Craftsmanship Warranty · installed Oct 20, 2026')
    expect(badgeText({ warrantyName: null, installDate: null })).toBe('Past customer · No warranty on file')
  })
})

describe('the report', () => {
  const t = (o: Partial<ReportTicket>): ReportTicket => ({ id: Math.random().toString(36), month: '2026-10', decision: null, stage: 'new', fenceStyle: 'White vinyl privacy', installer: 'Crew A', costCents: null, laborCents: null, materialCents: null, ...o })
  test('by month: covered, not covered, not decided, covered cost; cost by style and installer from covered tickets only', () => {
    const r = serviceReport([
      t({ decision: 'covered', stage: 'closed', costCents: 10000, laborCents: 7500, materialCents: 2500 }),
      t({ decision: 'covered', stage: 'fixed', costCents: 5001, laborCents: 5001, materialCents: 0, installer: 'Crew B' }),
      t({ decision: 'covered', stage: 'scheduled' }),
      t({ decision: 'not_covered', stage: 'closed', costCents: 99999, laborCents: 0, materialCents: 0 }),
      t({ month: '2026-09' }),
      t({ month: '2026-09', decision: 'covered', stage: 'closed', costCents: 2000, laborCents: 2000, materialCents: 0, fenceStyle: 'Tan vinyl privacy', installer: '' }),
    ])
    expect(r.totals).toEqual({ tickets: 6, covered: 4, notCovered: 1, undecided: 1, open: 3, coveredCostCents: 17001, costed: 3 })
    expect(r.byMonth).toEqual([
      { month: '2026-10', tickets: 4, covered: 3, notCovered: 1, undecided: 0, coveredCostCents: 15001 },
      { month: '2026-09', tickets: 2, covered: 1, notCovered: 0, undecided: 1, coveredCostCents: 2000 },
    ])
    expect(r.byStyle).toEqual([
      { key: 'White vinyl privacy', tickets: 3, costed: 2, costCents: 15001, laborCents: 12501, materialCents: 2500, averageCents: 7501 },
      { key: 'Tan vinyl privacy', tickets: 1, costed: 1, costCents: 2000, laborCents: 2000, materialCents: 0, averageCents: 2000 },
    ])
    expect(r.byInstaller.map(x => [x.key, x.costCents, x.tickets])).toEqual([['Crew A', 10000, 2], ['Crew B', 5001, 1], ['Not recorded', 2000, 1]])
  })
  test('nothing: zeros', () => {
    expect(serviceReport([])).toEqual({ totals: { tickets: 0, covered: 0, notCovered: 0, undecided: 0, open: 0, coveredCostCents: 0, costed: 0 }, byMonth: [], byStyle: [], byInstaller: [] })
  })
})
