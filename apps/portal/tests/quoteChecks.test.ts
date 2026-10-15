/** Warnings that catch bad quotes, and voice entry of sides. */

import { describe, test, expect } from 'vitest'
import { tapeChecks, gateChecks, marginCheck, normalPerFoot, perFootCheck, parseSpokenSides } from '../../web/src/quoteChecks'
import { layoutForShape } from '../../web/src/yardLayout'

describe('tape measure check', () => {
  const run = (ft: number) => ({ ft, label: `Back (${ft})` })
  test('right on a whole number of sections, or up to 6 inches over', () => {
    expect(tapeChecks([run(80)], [8])).toHaveLength(1)                 // 80' at 8'
    expect(tapeChecks([run(72)], [6])).toHaveLength(1)                 // 72' at 6'
    expect(tapeChecks([run(80 + 4 / 12)], [8])).toHaveLength(1)        // 80' 4"
    expect(tapeChecks([run(80 + 6 / 12)], [8])).toHaveLength(1)        // 80' 6"
    expect(tapeChecks([run(80 + 7 / 12)], [8])).toHaveLength(0)        // 80' 7"
    expect(tapeChecks([run(81)], [8])).toHaveLength(0)
    expect(tapeChecks([run(79)], [8])).toHaveLength(0)
    expect(tapeChecks([run(4)], [8])).toHaveLength(0)                  // shorter than one section
    expect(tapeChecks([run(80)], [8])[0]).toBe('Back (80): Check this run with a tape measure. A few inches either way changes the section count.')
  })
})

describe('gate checks', () => {
  test('a gate on a side under 6 ft, or wider than the side', () => {
    const l = layoutForShape('backyard')
    l.sides[0].lengthIn = 60; l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'middle' }
    l.sides[4].lengthIn = 96; l.sides[4].gate = { type: 'double', widthIn: 120, position: 'middle' }
    l.sides[2].lengthIn = 1800; l.sides[2].gate = { type: 'walk', widthIn: 48, position: 'middle' }
    const out = gateChecks(l)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatch(/^Left return is under 6 ft/)
    expect(out[1]).toMatch(/^Right return: the gate \(10' 0"\) is wider than the side \(8' 0"\)/)
  })
})

describe('margin', () => {
  test('under the target', () => {
    expect(marginCheck(0.3, 0.34, 5000)).toBe('Margin is 30.0%, under your 34% target in Settings.')
    expect(marginCheck(0.4, 0.34, 5000)).toBeNull()
  })
})

describe('price per foot against past quotes', () => {
  const past = [28, 30, 31, 32, 33, 34, 35, 36, 38, 40].map((ppf, i) => ({ id: `q${i}`, fenceStyle: 'WV-ND 6\'x8\' Privacy', finalPrice: ppf * 100, runs: [100] }))
  test('normal range is the middle of past quotes', () => {
    expect(normalPerFoot('WV-ND 6\'x8\' Privacy', past)).toEqual({ low: 30, high: 38, n: 10 })
    expect(normalPerFoot('CL - 4\' Galv', past)).toBeNull()
  })
  test('far above or below warns, inside the range does not', () => {
    expect(perFootCheck(50, 'WV-ND 6\'x8\' Privacy', past)).toMatch(/^\$50\.00 a foot is far above your past WV-ND 6'x8' Privacy quotes \(usually \$30\.00 to \$38\.00 a foot, from 10 past quotes\)/)
    expect(perFootCheck(20, 'WV-ND 6\'x8\' Privacy', past)).toMatch(/far below/)
    expect(perFootCheck(36, 'WV-ND 6\'x8\' Privacy', past)).toBeNull()
  })
})

describe('voice entry', () => {
  const names = ['Left return', 'Left side', 'Back', 'Right side', 'Right return']
  test("Jonathan's example", () => {
    expect(parseSpokenSides('left side one twenty, back one fifty, right return thirty with a four foot gate', names)).toEqual([
      { name: 'Left side', lengthIn: 1440 },
      { name: 'Back', lengthIn: 1800 },
      { name: 'Right return', lengthIn: 360, gate: { type: 'walk', widthIn: 48 } },
    ])
  })
  test('digits, feet and inches, double gates', () => {
    expect(parseSpokenSides('Back 150 feet 6 inches. Left return 30 with a 10 foot double gate', names)).toEqual([
      { name: 'Back', lengthIn: 1806 },
      { name: 'Left return', lengthIn: 360, gate: { type: 'double', widthIn: 120 } },
    ])
    expect(parseSpokenSides('right side a hundred and five and a half', names)).toEqual([{ name: 'Right side', lengthIn: 1266 }])
    expect(parseSpokenSides('left side eighty four, back two oh five', names)).toEqual([{ name: 'Left side', lengthIn: 1008 }, { name: 'Back', lengthIn: 2460 }])
    expect(parseSpokenSides('back one hundred twelve with a walk gate', names)).toEqual([{ name: 'Back', lengthIn: 1344, gate: { type: 'walk', widthIn: 48 } }])
  })
})
