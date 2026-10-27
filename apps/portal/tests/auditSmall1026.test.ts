/**
 * Smaller audit fixes (Oct 26 2026): Smart Schedule's "Need Drawing" on a job
 * the customer drew, Search by the quote number shown on the quote, and the
 * install start Schedule install offers before 811 good to dig.
 */

import { describe, test, expect } from 'vitest'
import { hasDrawing } from '../../web/src/jobDrawing'
import { quoteNumber, matchesQuoteNumber } from '../../web/src/quoteNumber'
import { firstInstallDay } from '../src/server/lib/installDays.js'

describe('Smart Schedule: Need Drawing only when there is no drawing', () => {
  test('the customer\'s website drawing, or a yard drawn in the quote builder, is a drawing', () => {
    expect(hasDrawing({ drawingComplete: false }, { layout: { yard: null, widgetDrawing: { sides: [] } } })).toBe(true)
    expect(hasDrawing({ drawingComplete: false }, { layout: { yard: { runs: [] } } })).toBe(true)
    expect(hasDrawing({ drawingComplete: true }, null)).toBe(true)
  })
  test('a quote typed as a run list, or no quote: Need Drawing', () => {
    expect(hasDrawing({ drawingComplete: false }, { layout: { yard: null } })).toBe(false)
    expect(hasDrawing({}, null)).toBe(false)
  })
})

describe('Search by quote number', () => {
  const id = '6c1b7e0a-0000-4000-8000-00000adffd02'
  test('the number shown on the quote is its id\'s last 6, in capitals', () => {
    expect(quoteNumber(id)).toBe('DFFD02')
  })
  test('found by "#DFFD02", "dffd02" or a part of 4 or more', () => {
    for (const t of ['#DFFD02', 'dffd02', ' #dffd02 ', 'DFFD', 'FD02']) expect(matchesQuoteNumber(id, t)).toBe(true)
  })
  test('not by a name, a short piece or another number', () => {
    for (const t of ['dff', 'Walker', '#AAAA02', '']) expect(matchesQuoteNumber(id, t)).toBe(false)
  })
})

describe('Schedule install: the first day offered', () => {
  const monThu = [1, 2, 3, 4]
  test('the next crew day after today', () => {
    expect(firstInstallDay('2026-10-26', monThu)).toBe('2026-10-27')
    expect(firstInstallDay('2026-10-29', monThu)).toBe('2026-11-02') // Thursday: next Monday
  })
  test('never before 811 good to dig (and on a crew day)', () => {
    expect(firstInstallDay('2026-10-26', monThu, '2026-10-29')).toBe('2026-10-29')
    expect(firstInstallDay('2026-10-26', monThu, '2026-10-30')).toBe('2026-11-02') // Friday good to dig: Monday
    expect(firstInstallDay('2026-10-26', monThu, '2026-10-20')).toBe('2026-10-27') // already clear
    expect(firstInstallDay('2026-10-26', monThu, 'not a date')).toBe('2026-10-27')
  })
})
