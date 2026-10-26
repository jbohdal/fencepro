/**
 * A repair is summed up by its work, never "0 sections / 0 ft", and its crew
 * time follows its own man hours (round 2 review, Oct 26 2026: "Total
 * sections 0 · Total footage 0 ft · Crew time 0.0 hr" beside 1.7 man hours).
 */

import { describe, test, expect } from 'vitest'
import { sectionsCell, sizeText, repairLines } from '../../web/src/moveRepair'
import { crewTime } from '../../web/src/pricingEngine'

const repair = { type: 'repair', repair: { what: 'gate', items: { replacePost: 2, rehangGate: 1 }, gateKind: 'walk' } } as any
const move = { type: 'move', crew: ['Take down 60 ft', 'Reset on the new line'], description: 'Move the fence' } as any

describe('a repair in a list or a sentence', () => {
  test('the repair work, never 0', () => {
    expect(sectionsCell(0, repair)).toBe('Repair: 2 × Replace a post · 1 × Rehang a gate with new hardware')
    expect(sizeText(0, repair)).toBe('Repair: 2 × Replace a post · 1 × Rehang a gate with new hardware')
    expect(repairLines(repair)).toEqual(['2 × Replace a post', '1 × Rehang a gate with new hardware'])
  })
  test('a new fence and a move keep their sections', () => {
    expect(sectionsCell(16, null)).toBe('16')
    expect(sizeText(16, undefined)).toBe('16 sections')
    expect(sizeText(1, null)).toBe('1 section')
    expect(sectionsCell(12, move)).toBe('12')
    expect(sectionsCell(0, move)).toBe('Fence move: Take down 60 ft · Reset on the new line')
    expect(repairLines(move)).toBeNull()
    expect(repairLines(null)).toBeNull()
  })
  test('a repair with nothing picked says Repair', () => {
    expect(sectionsCell(0, { type: 'repair', repair: { items: {} }, crew: [], description: '' } as any)).toBe('Repair: As described on the quote.')
  })
})

describe('crew time', () => {
  test('from the man hours shown, at the crew size and day length the price used', () => {
    // A repair: the new fence math had 0 man hours (crewHours 0), the repair 1.7.
    const t = crewTime(1.7, { crewSize: 2, crewHours: 0, crewDays: 0 }, 8)
    expect(t.size).toBe(2)
    expect(t.hours).toBeCloseTo(0.85, 5)
    expect(t.days).toBeCloseTo(0.85 / 8, 5)
    // A new fence: the same as the price's own numbers.
    const f = crewTime(30, { crewSize: 3, crewHours: 10, crewDays: 1 })
    expect(f).toEqual({ size: 3, hours: 10, days: 1 })
    expect(crewTime(4, { crewSize: 0, crewHours: 0, crewDays: 0 })).toEqual({ size: 3, hours: 4 / 3, days: 4 / 3 / 10 })
  })
})
